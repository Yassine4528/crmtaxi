import { billingSummary, buildMemo, fromIso, isoMonth, toIso, type Memo } from '@taxi-crm/domain';
import { and, gte, isNotNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { circuits, events } from '../db/schema.ts';
import { loadSettings, toCircuit, toEvent } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

async function monthData(db: Db, month: string) {
  const first = fromIso(`${month}-01`);
  const last = toIso(new Date(first.getFullYear(), first.getMonth() + 1, 0));
  const [circuitRows, eventRows, settings] = await Promise.all([
    db.select().from(circuits),
    db
      .select()
      .from(events)
      .where(and(isNotNull(events.circuitId), gte(events.date, `${month}-01`), lte(events.date, last))),
    loadSettings(db),
  ]);
  return { circuits: circuitRows.map(toCircuit), events: eventRows.map((e) => toEvent(e)), settings };
}

export function billingRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/billing/:month', async (req) => {
    requireAdmin(req);
    const { month } = z.object({ month: isoMonth }).parse(req.params);
    const data = await monthData(db, month);
    return billingSummary(data.circuits, data.events, data.settings, month);
  });

  app.get('/api/billing/:month/memos', async (req) => {
    requireAdmin(req);
    const { month } = z.object({ month: isoMonth }).parse(req.params);
    const { circuitId } = z.object({ circuitId: z.string().optional() }).parse(req.query);
    const data = await monthData(db, month);
    return data.circuits
      .filter((c) => !circuitId || c.id === circuitId)
      .map((c) => buildMemo(c, data.events, data.settings, month))
      .filter((m): m is Memo => m !== null);
  });
}
