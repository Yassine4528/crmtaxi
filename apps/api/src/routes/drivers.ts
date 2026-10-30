import { randomUUID } from 'node:crypto';
import { driverCreateSchema, driverUpdateSchema, normalize, type Driver } from '@taxi-crm/domain';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_LOGIN, closeSessions, requireAdmin, requireUser } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { circuits, events, users } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { toCircuit } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

const toDriver = (u: typeof users.$inferSelect): Driver => ({
  id: u.id,
  name: u.name,
  hasCode: !!u.passwordHash,
  canAdd: u.canAdd,
  canDelete: u.canDelete,
});

const idParam = z.object({ id: z.string() });

async function assertLoginFree(db: Db, name: string, exceptId?: string): Promise<string> {
  const login = normalize(name);
  if (login === ADMIN_LOGIN) throw badRequest('Ce nom est réservé au gérant.');
  const [twin] = await db
    .select({ id: users.id })
    .from(users)
    .where(exceptId ? and(eq(users.login, login), ne(users.id, exceptId)) : eq(users.login, login))
    .limit(1);
  // le nom sert d'identifiant de connexion
  if (twin) throw badRequest(`Un chauffeur s'appelle déjà « ${name} ».`);
  return login;
}

/** Le code d'un chauffeur ne doit jamais être celui du gérant : il donnerait accès à tout par simple essai. */
async function assertNotAdminCode(db: Db, code: string): Promise<void> {
  const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
  if (admin?.passwordHash && (await verifyPassword(code, admin.passwordHash))) {
    throw badRequest('Ce code est celui du gérant : choisissez-en un autre.');
  }
}

export function driverRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/drivers', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(users)
      .where(user.role === 'admin' ? eq(users.role, 'driver') : eq(users.id, user.id))
      .orderBy(asc(users.createdAt), asc(users.name));
    return rows.map(toDriver);
  });

  app.post('/api/drivers', async (req) => {
    requireAdmin(req);
    const { name, code } = driverCreateSchema.parse(req.body);
    const login = await assertLoginFree(db, name);
    if (code) await assertNotAdminCode(db, code);
    const [row] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        name,
        login,
        role: 'driver',
        passwordHash: code ? await hashPassword(code) : null,
      })
      .returning();
    return toDriver(row!);
  });

  app.patch('/api/drivers/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const input = driverUpdateSchema.parse(req.body);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
      patch.login = await assertLoginFree(db, input.name, id);
    }
    if (input.canAdd !== undefined) patch.canAdd = input.canAdd;
    if (input.canDelete !== undefined) patch.canDelete = input.canDelete;
    if (input.code !== undefined) {
      if (input.code) await assertNotAdminCode(db, input.code);
      patch.passwordHash = input.code ? await hashPassword(input.code) : null;
      patch.failedAttempts = 0;
      patch.lockedUntil = null;
    }
    const [row] = await db
      .update(users)
      .set(patch)
      .where(and(eq(users.id, id), eq(users.role, 'driver')))
      .returning();
    if (!row) throw notFound();
    if (input.code !== undefined) await closeSessions(db, id);
    return toDriver(row);
  });

  /** Nombre de rendez-vous concernés, pour la confirmation avant suppression. */
  app.get('/api/drivers/:id/impact', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const [row] = await db.select({ n: count() }).from(events).where(eq(events.driverId, id));
    return { events: row?.n ?? 0 };
  });

  app.delete('/api/drivers/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    await db.transaction(async (tx) => {
      // les trajets réguliers du chauffeur redeviennent « à attribuer »
      const all = (await tx.select().from(circuits)).map(toCircuit);
      for (const circuit of all) {
        if (!circuit.config.trips.some((t) => t.driverId === id)) continue;
        const trips = circuit.config.trips.map((t) => (t.driverId === id ? { ...t, driverId: null } : t));
        await tx
          .update(circuits)
          .set({ config: { ...circuit.config, trips } })
          .where(eq(circuits.id, circuit.id));
      }
      const gone = await tx
        .delete(users)
        .where(and(eq(users.id, id), eq(users.role, 'driver')))
        .returning({ id: users.id });
      if (!gone.length) throw notFound();
    });
    return { ok: true };
  });
}
