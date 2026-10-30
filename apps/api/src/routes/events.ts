import { randomUUID } from 'node:crypto';
import {
  addDays,
  applyPresence,
  createEventSchema,
  eventRangeSchema,
  eventStatusSchema,
  fromIso,
  moveEventsSchema,
  presenceSchema,
  recurrenceDates,
  updateEventSchema,
  type AgendaEvent,
  type SessionUser,
} from '@taxi-crm/domain';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { circuits, clients, events } from '../db/schema.ts';
import { badRequest, forbidden, notFound } from '../lib/http.ts';
import { redactEvent, toCircuit, toEvent } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

const idParam = z.object({ id: z.string() });
const MAX_RANGE_DAYS = 400;
const MAX_OCCURRENCES = 400;

/** Sépare ce que chaque rôle peut voir : un chauffeur ne reçoit que ses courses, sans aucun montant. */
const present = (user: SessionUser, event: AgendaEvent) => (user.role === 'admin' ? event : redactEvent(event));
const scope = (user: SessionUser, condition: SQL | undefined) =>
  user.role === 'admin' ? condition : and(eq(events.driverId, user.id), condition);

async function loadEvent(db: Db, id: string, user: SessionUser): Promise<typeof events.$inferSelect> {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) throw notFound();
  // même réponse qu'un identifiant inexistant : ne révèle pas l'existence des courses des autres
  if (user.role !== 'admin' && row.driverId !== user.id) throw notFound();
  return row;
}

const queryWithClients = (db: Db) =>
  db.select({ event: events, client: clients }).from(events).leftJoin(clients, eq(events.clientId, clients.id));

export function eventRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/events', async (req) => {
    const user = requireUser(req);
    const { from, to } = eventRangeSchema.parse(req.query);
    if (to < from) throw badRequest('Période invalide.');
    if (fromIso(to).getTime() - fromIso(from).getTime() > MAX_RANGE_DAYS * 864e5) {
      throw badRequest('Période trop longue.');
    }
    const rows = await queryWithClients(db)
      .where(scope(user, and(gte(events.date, from), lte(events.date, to))))
      .orderBy(asc(events.date), asc(events.startMin));
    return rows.map((r) => present(user, toEvent(r.event, r.client)));
  });

  app.get('/api/events/search', async (req) => {
    const user = requireUser(req);
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await queryWithClients(db)
      .where(scope(user, or(ilike(events.title, pattern), ilike(events.notes, pattern))))
      .orderBy(desc(events.date), asc(events.startMin))
      .limit(30);
    return rows.map((r) => present(user, toEvent(r.event, r.client)));
  });

  /** Signalements « annulé / absent » à traiter par le gérant. */
  app.get('/api/events/flagged', async (req) => {
    requireAdmin(req);
    const rows = await db
      .select()
      .from(events)
      .where(isNotNull(events.status))
      .orderBy(asc(events.date), asc(events.startMin));
    return rows.map((r) => toEvent(r));
  });

  app.post('/api/events', async (req) => {
    const user = requireUser(req);
    if (!user.canAdd) throw forbidden();
    const input = createEventSchema.parse(req.body);
    if (input.end <= input.start) throw badRequest("L'heure de fin doit être après l'heure de début.");

    const fields = {
      driverId: user.role === 'admin' ? input.driverId : user.id,
      startMin: input.start,
      endMin: input.end,
      title: input.title,
      notes: input.notes,
      color: input.color,
      clientId: user.role === 'admin' ? (input.clientId ?? null) : null,
    };

    let dates = [input.date];
    let seriesId: string | null = null;
    const rec = input.recurrence;
    if (rec) {
      const from = fromIso(input.date);
      if (rec.count == null && (!rec.until || rec.until < input.date)) {
        throw badRequest('La date de fin de récurrence doit être après la date du rendez-vous.');
      }
      dates = rec.count
        ? recurrenceDates(from, addDays(from, 365 * 35), rec.every, rec.weekdays, rec.count)
        : recurrenceDates(from, fromIso(rec.until!), rec.every, rec.weekdays, MAX_OCCURRENCES + 1);
      if (!dates.length) throw badRequest('Aucune date ne correspond à cette récurrence.');
      if (dates.length > MAX_OCCURRENCES) {
        throw badRequest('Trop de rendez-vous (plus de 400) : raccourcissez la période.');
      }
      seriesId = randomUUID();
    }
    const rows = await db
      .insert(events)
      .values(dates.map((date) => ({ ...fields, id: randomUUID(), date, seriesId })))
      .returning();
    return { created: rows.length, firstDate: dates[0]!, event: present(user, toEvent(rows[0]!)) };
  });

  app.put('/api/events/:id', async (req) => {
    const user = requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const { applyToFollowing, ...input } = updateEventSchema.parse(req.body);
    if (input.end <= input.start) throw badRequest("L'heure de fin doit être après l'heure de début.");
    const current = await loadEvent(db, id, user);
    const fields = {
      driverId: input.driverId,
      startMin: input.start,
      endMin: input.end,
      title: input.title,
      notes: input.notes,
      color: input.color,
      clientId: input.clientId ?? null,
      updatedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ ...fields, date: input.date })
        .where(eq(events.id, id));
      if (applyToFollowing && current.seriesId) {
        await tx
          .update(events)
          .set(fields)
          .where(and(eq(events.seriesId, current.seriesId), gt(events.date, current.date)));
      }
    });
    return { ok: true };
  });

  /** Glisser-déposer du gérant : autre chauffeur, autre jour ou autre heure. */
  app.post('/api/events/move', async (req) => {
    requireAdmin(req);
    const { ids, driverId, date, shift } = moveEventsSchema.parse(req.body);
    const updated = await db
      .update(events)
      .set({
        driverId,
        date,
        startMin: sql`${events.startMin} + ${shift}`,
        endMin: sql`${events.endMin} + ${shift}`,
        updatedAt: new Date(),
      })
      .where(inArray(events.id, ids))
      .returning({ id: events.id });
    return { moved: updated.length };
  });

  app.delete('/api/events/:id', async (req) => {
    const user = requireUser(req);
    if (!user.canDelete) throw forbidden();
    const { id } = idParam.parse(req.params);
    const { scope: range } = z.object({ scope: z.enum(['one', 'following']).default('one') }).parse(req.query);
    const current = await loadEvent(db, id, user);
    if (range === 'following') {
      if (!current.seriesId) throw badRequest("Ce rendez-vous n'appartient à aucune série.");
      const deleted = await db
        .delete(events)
        .where(
          and(
            eq(events.seriesId, current.seriesId),
            gte(events.date, current.date),
            // un chauffeur ne touche jamais les courses d'un autre, même de la même série
            user.role === 'admin' ? undefined : eq(events.driverId, user.id),
          ),
        )
        .returning({ id: events.id });
      return { deleted: deleted.length };
    }
    await db.delete(events).where(eq(events.id, id));
    return { deleted: 1 };
  });

  /** Nombre de rendez-vous concernés par « celui-ci et suivants ». */
  app.get('/api/events/:id/following-count', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const current = await loadEvent(db, id, user);
    if (!current.seriesId) return { count: 1 };
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(scope(user, and(eq(events.seriesId, current.seriesId), gte(events.date, current.date))));
    return { count: rows.length };
  });

  /** Signalement annulé / absent par le chauffeur de la course ou le gérant. */
  app.post('/api/events/:id/status', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: eventStatusSchema.nullable() }).parse(req.body);
    await loadEvent(db, id, user);
    await db
      .update(events)
      .set({
        status,
        statusBy: status ? (user.role === 'admin' ? 'le gérant' : user.name) : null,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id));
    return { ok: true };
  });

  app.put('/api/events/:id/presence', async (req) => {
    const user = requireUser(req);
    const { id } = idParam.parse(req.params);
    const input = presenceSchema.parse(req.body);
    const row = await loadEvent(db, id, user);
    if (!row.run) throw badRequest("Cette course n'a pas de liste de présence.");
    const [circuitRow] = row.circuitId
      ? await db.select().from(circuits).where(eq(circuits.id, row.circuitId)).limit(1)
      : [];
    const circuit = circuitRow ? toCircuit(circuitRow) : undefined;
    const { run, learnedRate } = applyPresence(toEvent(row), circuit, input, user.role === 'admin');
    await db.transaction(async (tx) => {
      await tx.update(events).set({ run, updatedAt: new Date() }).where(eq(events.id, id));
      if (learnedRate && circuit) {
        const config = {
          ...circuit.config,
          rates: { ...circuit.config.rates, [learnedRate.key]: learnedRate.rate },
        };
        await tx.update(circuits).set({ config }).where(eq(circuits.id, circuit.id));
      }
    });
    return { ok: true };
  });
}
