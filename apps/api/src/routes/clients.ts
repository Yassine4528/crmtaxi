import { randomUUID } from 'node:crypto';
import { clientInputSchema, clientLabel, normalize } from '@taxi-crm/domain';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { clients, events } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { toClient, toEvent } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

const idParam = z.object({ id: z.string() });

const parseClient = (body: unknown) => {
  const input = clientInputSchema.parse(body);
  return { ...input, nom: input.nom.toUpperCase() };
};

async function assertUnique(db: Db, label: string, exceptId?: string): Promise<void> {
  const all = await db.select().from(clients);
  const twin = all.find((c) => c.id !== exceptId && normalize(clientLabel(c)) === normalize(label));
  if (twin) throw badRequest(`Une fiche « ${label} » existe déjà.`);
}

export function clientRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/clients', async (req) => {
    requireAdmin(req);
    const rows = await db.select().from(clients).orderBy(asc(clients.nom), asc(clients.prenom));
    return rows.map(toClient);
  });

  app.post('/api/clients', async (req) => {
    requireAdmin(req);
    const input = parseClient(req.body);
    await assertUnique(db, clientLabel(input));
    const [row] = await db
      .insert(clients)
      .values({ ...input, id: randomUUID() })
      .returning();
    return toClient(row!);
  });

  app.put('/api/clients/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const input = parseClient(req.body);
    await assertUnique(db, clientLabel(input), id);
    const [row] = await db.update(clients).set(input).where(eq(clients.id, id)).returning();
    if (!row) throw notFound();
    return toClient(row);
  });

  app.delete('/api/clients/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    // les rendez-vous restent dans l'agenda (clé étrangère ON DELETE SET NULL)
    await db.delete(clients).where(eq(clients.id, id));
    return { ok: true };
  });

  app.get('/api/clients/:id/events', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.clientId, id))
      .orderBy(asc(events.date), asc(events.startMin));
    return rows.map((r) => toEvent(r));
  });
}
