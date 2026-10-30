import {
  clientLabel,
  type AgendaEvent,
  type Circuit,
  type CircuitSummary,
  type Client,
  type Run,
  type Settings,
} from '@taxi-crm/domain';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { circuits, clients, events, settings } from './db/schema.ts';

type EventRow = typeof events.$inferSelect;
type ClientRow = typeof clients.$inferSelect;

export const toEvent = (row: EventRow, client?: ClientRow | null): AgendaEvent => ({
  id: row.id,
  driverId: row.driverId,
  date: row.date,
  start: row.startMin,
  end: row.endMin,
  title: row.title,
  notes: row.notes,
  color: row.color,
  clientId: row.clientId,
  seriesId: row.seriesId,
  status: row.status,
  statusBy: row.statusBy,
  circuitId: row.circuitId,
  run: row.run,
  ...(client !== undefined
    ? { client: client ? { label: clientLabel(client), tel: client.tel, address: client.address } : null }
    : {}),
});

export const toEventRow = (e: Omit<AgendaEvent, 'client'>): typeof events.$inferInsert => ({
  id: e.id,
  driverId: e.driverId,
  date: e.date,
  startMin: e.start,
  endMin: e.end,
  title: e.title,
  notes: e.notes,
  color: e.color,
  clientId: e.clientId ?? null,
  seriesId: e.seriesId,
  status: e.status,
  statusBy: e.statusBy,
  circuitId: e.circuitId,
  run: e.run,
});

/** Retire tout montant d'une course : un chauffeur ne doit jamais les recevoir, même masqués. */
function redactRun(run: Run): Run {
  return {
    period: run.period,
    ...(run.tripId ? { tripId: run.tripId } : {}),
    riders: run.riders.map((r) => ({ name: r.name, ...(r.label ? { label: r.label } : {}), absent: r.absent })),
  };
}

export const redactEvent = (event: AgendaEvent): AgendaEvent => ({
  ...event,
  run: event.run ? redactRun(event.run) : null,
});

export const toCircuit = (row: typeof circuits.$inferSelect): Circuit => ({
  id: row.id,
  name: row.name,
  establishmentId: row.establishmentId,
  mode: row.mode,
  driverId: row.driverId,
  color: row.color,
  config: row.config,
});

export const toCircuitSummary = (c: Circuit): CircuitSummary => ({
  id: c.id,
  name: c.name,
  mode: c.mode,
  color: c.color,
  stops: c.config.stops,
  ...(c.config.source ? { source: c.config.source } : {}),
  ...(c.config.notes ? { notes: c.config.notes } : {}),
});

export const toClient = (row: ClientRow): Client => ({
  id: row.id,
  nom: row.nom,
  prenom: row.prenom,
  tel: row.tel,
  address: row.address,
  notes: row.notes,
});

export const DEFAULT_SETTINGS: Settings = {
  companyName: 'Taxi CRM',
  vatPercent: 10,
  companyAddress: '',
  establishments: [],
};

export async function loadSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    companyName: row.companyName,
    vatPercent: row.vatPercent,
    companyAddress: row.companyAddress,
    establishments: row.establishments,
  };
}

export async function saveSettings(db: Pick<Db, 'insert'>, value: Settings): Promise<void> {
  await db
    .insert(settings)
    .values({ id: 1, ...value })
    .onConflictDoUpdate({ target: settings.id, set: value });
}
