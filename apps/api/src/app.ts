import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerSessionHook } from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { auditLog } from './db/schema.ts';
import { HttpError } from './lib/http.ts';
import { registerRoutes } from './routes/index.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(db: Db, config: Config): Promise<FastifyInstance> {
  const isProduction = config.NODE_ENV === 'production';
  const app = Fastify({
    trustProxy: isProduction, // Railway termine le TLS devant l'application
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            serializers: {
              // jamais de paramètres de requête dans les journaux : une recherche contient des noms
              req: (req) => ({ method: req.method, url: req.url.split('?')[0], reqId: req.id }),
            },
          },
  });

  await app.register(helmet, {
    hsts: isProduction,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  registerSessionHook(app, db);

  app.addHook('onResponse', async (req, reply) => {
    if (!WRITE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    try {
      await db.insert(auditLog).values({
        userId: req.user?.id ?? null,
        action: `${req.method} ${req.routeOptions.url ?? 'inconnue'}`,
        entityId: (req.params as { id?: string } | undefined)?.id ?? null,
        statusCode: reply.statusCode,
      });
    } catch (err) {
      req.log.error(err, "Échec de l'écriture du journal d'audit");
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: err.issues[0]?.message ?? 'Données invalides.' });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: err.statusCode === 429 ? 'Trop de requêtes : réessayez dans un instant.' : 'Requête invalide.',
      });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'Erreur interne du serveur.' });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  registerRoutes(app, { db, secureCookies: isProduction });

  const webRoot = resolve(config.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)));
  const serveWeb = existsSync(resolve(webRoot, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      setHeaders: (res, path) => {
        res.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (serveWeb && req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.status(404).send({ error: 'Introuvable.' });
  });

  return app;
}
