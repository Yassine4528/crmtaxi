import { randomUUID } from 'node:crypto';
import {
  circuitInputSchema,
  deleteRunsSchema,
  fromIso,
  generateRunsSchema,
  planRuns,
  propagateCircuitChange,
  toIso,
  type Circuit,
} from '@taxi-crm/domain';
import { and, asc, count, eq, gte, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth.ts';
import { circuits, events } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { toCircuit, toCircuitSummary, toEvent, toEventRow } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

const idParam = z.object({ id: z.string() });
const MAX_GENERATION_DAYS = 370;

function assertPeriod(from: string, to: string): void {
  if (to < from) throw badRequest('Choisissez une période valide.');
  if (fromIso(to).getTime() - fromIso(from).getTime() > MAX_GENERATION_DAYS * 864e5) {
    throw badRequest('Période trop longue : une année scolaire au maximum.');
  }
}

export function circuitRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/circuits', async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(circuits).orderBy(asc(circuits.createdAt), asc(circuits.name));
    const all = rows.map(toCircuit);
    if (user.role === 'admin') return all;
    // un chauffeur ne voit que les consignes des circuits qu'il assure, sans tarifs ni conventions
    const mine = await db.selectDistinct({ id: events.circuitId }).from(events).where(eq(events.driverId, user.id));
    const ids = new Set(mine.map((m) => m.id));
    return all.filter((c) => ids.has(c.id)).map(toCircuitSummary);
  });

  app.post('/api/circuits', async (req) => {
    requireAdmin(req);
    const input = circuitInputSchema.parse(req.body);
    const [row] = await db
      .insert(circuits)
      .values({ ...input, id: randomUUID() })
      .returning();
    return toCircuit(row!);
  });

  /** Enregistre le circuit et répercute horaires et tarifs sur ses courses à venir. */
  app.put('/api/circuits/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const input = circuitInputSchema.parse(req.body);
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(circuits).where(eq(circuits.id, id)).limit(1);
      if (!row) throw notFound();
      const before = toCircuit(row);
      const after: Circuit = { ...input, id };
      const today = toIso(new Date());
      const future = await tx
        .select()
        .from(events)
        .where(and(eq(events.circuitId, id), gte(events.date, today)));
      const changed = propagateCircuitChange(
        before,
        after,
        future.map((e) => toEvent(e)),
      );
      for (const event of changed) {
        await tx
          .update(events)
          .set({ startMin: event.start, endMin: event.end, run: event.run, updatedAt: new Date() })
          .where(eq(events.id, event.id));
      }
      const [saved] = await tx.update(circuits).set(input).where(eq(circuits.id, id)).returning();
      return toCircuit(saved!);
    });
  });

  app.get('/api/circuits/:id/impact', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const [row] = await db.select({ n: count() }).from(events).where(eq(events.circuitId, id));
    return { events: row?.n ?? 0 };
  });

  app.delete('/api/circuits/:id', async (req) => {
    requireAdmin(req);
    const { id } = idParam.parse(req.params);
    await db.delete(circuits).where(eq(circuits.id, id));
    return { ok: true };
  });

  /** Crée les courses du planning type sur une période. Relancer ne crée pas de doublons. */
  app.post('/api/circuits/generate', async (req) => {
    requireAdmin(req);
    const { from, to, circuitIds } = generateRunsSchema.parse(req.body);
    assertPeriod(from, to);
    return db.transaction(async (tx) => {
      const selected = (await tx.select().from(circuits).where(inArray(circuits.id, circuitIds))).map(toCircuit);
      const missing = selected.filter((c) => !c.driverId && !c.config.trips.length);
      if (missing.length) {
        throw badRequest(`Choisissez d'abord le chauffeur de : ${missing.map((c) => c.name).join(', ')}.`);
      }
      const existing = (
        await tx
          .select()
          .from(events)
          .where(and(inArray(events.circuitId, circuitIds), gte(events.date, from), lte(events.date, to)))
      ).map((e) => toEvent(e));

      let created = 0;
      let skipped = 0;
      for (const circuit of selected) {
        const planned = planRuns(circuit, from, to, existing, randomUUID);
        skipped += planned.skipped;
        created += planned.events.length;
        if (planned.events.length) await tx.insert(events).values(planned.events.map(toEventRow));
        await tx
          .update(circuits)
          .set({ config: { ...circuit.config, series: planned.series } })
          .where(eq(circuits.id, circuit.id));
      }
      return { created, skipped };
    });
  });

  app.post('/api/circuits/delete-runs', async (req) => {
    requireAdmin(req);
    const { from, to, circuitIds, dryRun } = deleteRunsSchema.parse(req.body);
    if (to < from) throw badRequest('Choisissez une période valide.');
    const where = and(inArray(events.circuitId, circuitIds), gte(events.date, from), lte(events.date, to));
    if (dryRun) {
      const [row] = await db.select({ n: count() }).from(events).where(where);
      return { count: row?.n ?? 0 };
    }
    const deleted = await db.delete(events).where(where).returning({ id: events.id });
    return { count: deleted.length };
  });
}
