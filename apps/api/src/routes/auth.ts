import { changePasswordSchema, loginSchema } from '@taxi-crm/domain';
import type { FastifyInstance } from 'fastify';
import { changePassword, login, logout, requireAdmin, requireUser } from '../auth.ts';
import type { RouteDeps } from './index.ts';

export function authRoutes(app: FastifyInstance, { db, secureCookies }: RouteDeps): void {
  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = await login(db, reply, loginSchema.parse(req.body), secureCookies);
    req.user = user;
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await logout(db, req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: requireUser(req) }));

  app.post('/api/auth/password', async (req) => {
    const user = requireAdmin(req);
    const { current, next } = changePasswordSchema.parse(req.body);
    await changePassword(db, req, user.id, current, next);
    return { ok: true };
  });
}
