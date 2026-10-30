import {
  circuitInputSchema,
  clientInputSchema,
  eventFieldsSchema,
  eventStatusSchema,
  normalize,
  parseLegacyBackup,
  runSchema,
  settingsSchema,
  type ImportedData,
} from '@taxi-crm/domain';
import { eq, inArray, notInArray, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_LOGIN, requireAdmin } from '../auth.ts';
import { circuits, clients, events, users } from '../db/schema.ts';
import { badRequest } from '../lib/http.ts';
import { loadSettings, saveSettings, toCircuit, toClient, toEvent, toEventRow } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

const BACKUP_FORMAT = 'taxi-crm-backup';
const BATCH = 500;
const RESTORE_BODY_LIMIT = 25 * 1024 * 1024;

/** Sauvegarde au format courant. Ne contient jamais de mot de passe ni de code d'accès. */
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  settings: settingsSchema,
  drivers: z.array(
    z.object({ id: z.string().min(1), name: z.string().min(1), canAdd: z.boolean(), canDelete: z.boolean() }),
  ),
  clients: z.array(clientInputSchema.extend({ id: z.string().min(1) })),
  circuits: z.array(circuitInputSchema.extend({ id: z.string().min(1) })),
  events: z.array(
    eventFieldsSchema.extend({
      id: z.string().min(1),
      seriesId: z.string().nullable(),
      status: eventStatusSchema.nullable(),
      statusBy: z.string().nullable(),
      circuitId: z.string().nullable(),
      run: runSchema.nullable(),
    }),
  ),
});

/** Reconnaît le format courant ou celui de l'ancienne application, puis revalide le résultat. */
function parseBackup(body: unknown): ImportedData {
  const isCurrent = (body as { format?: unknown } | null)?.format === BACKUP_FORMAT;
  const candidate = isCurrent ? body : { format: BACKUP_FORMAT, version: 1, ...parseLegacyBackup(body) };
  return backupSchema.parse(candidate) as ImportedData;
}

/** Le nom sert d'identifiant de connexion : deux homonymes ou « gérant » reçoivent un suffixe. */
function uniqueLogins(drivers: ImportedData['drivers']): Map<string, string> {
  const taken = new Set([ADMIN_LOGIN]);
  const out = new Map<string, string>();
  for (const d of drivers) {
    const base = normalize(d.name);
    let login = base;
    for (let i = 2; taken.has(login); i++) login = `${base}${i}`;
    taken.add(login);
    out.set(d.id, login);
  }
  return out;
}

export function backupRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/backup', async (req, reply) => {
    requireAdmin(req);
    const [settings, driverRows, clientRows, circuitRows, eventRows] = await Promise.all([
      loadSettings(db),
      db.select().from(users).where(eq(users.role, 'driver')),
      db.select().from(clients),
      db.select().from(circuits),
      db.select().from(events),
    ]);
    reply.header('Cache-Control', 'no-store');
    return {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      drivers: driverRows.map((d) => ({ id: d.id, name: d.name, canAdd: d.canAdd, canDelete: d.canDelete })),
      clients: clientRows.map(toClient),
      circuits: circuitRows.map(toCircuit),
      events: eventRows.map((e) => toEvent(e)),
    };
  });

  /** Remplace toutes les données. Les codes des chauffeurs déjà connus et le compte gérant sont conservés. */
  app.post('/api/backup/restore', { bodyLimit: RESTORE_BODY_LIMIT }, async (req) => {
    requireAdmin(req);
    let data: ImportedData;
    try {
      data = parseBackup(req.body);
    } catch {
      throw badRequest("Ce fichier n'est pas une sauvegarde de l'agenda.");
    }
    const logins = uniqueLogins(data.drivers);
    await db.transaction(async (tx) => {
      await tx.delete(events);
      await tx.delete(circuits);
      await tx.delete(clients);
      const keepIds = data.drivers.map((d) => d.id);
      await tx
        .delete(users)
        .where(
          keepIds.length ? and(eq(users.role, 'driver'), notInArray(users.id, keepIds)) : eq(users.role, 'driver'),
        );
      // libère les identifiants avant réattribution : deux chauffeurs peuvent échanger leurs noms
      if (keepIds.length) {
        const known = await tx.select({ id: users.id }).from(users).where(inArray(users.id, keepIds));
        for (const { id } of known)
          await tx
            .update(users)
            .set({ login: `tmp:${id}` })
            .where(eq(users.id, id));
      }
      for (const driver of data.drivers) {
        const values = {
          name: driver.name,
          login: logins.get(driver.id)!,
          canAdd: driver.canAdd,
          canDelete: driver.canDelete,
        };
        await tx
          .insert(users)
          .values({ id: driver.id, role: 'driver', ...values })
          .onConflictDoUpdate({ target: users.id, set: values });
      }
      if (data.clients.length) await tx.insert(clients).values(data.clients);
      if (data.circuits.length) await tx.insert(circuits).values(data.circuits);
      for (let i = 0; i < data.events.length; i += BATCH) {
        await tx.insert(events).values(data.events.slice(i, i + BATCH).map(toEventRow));
      }
      await saveSettings(tx, data.settings);
    });
    return { drivers: data.drivers.length, clients: data.clients.length, events: data.events.length };
  });
}
