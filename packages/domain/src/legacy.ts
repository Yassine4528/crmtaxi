import { z } from 'zod';
import { emptyCircuitConfig } from './circuits.ts';
import type { AgendaEvent, Circuit, CircuitConfig, Client, Period, Run, Settings } from './schemas.ts';

/**
 * Lecture des sauvegardes de l'ancienne application mono-fichier (localStorage).
 * Les codes d'accès qu'elles contiennent, en clair, sont volontairement ignorés.
 */
const legacyBackupSchema = z.looseObject({
  name: z.string().optional(),
  agendas: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      canAdd: z.boolean().optional(),
      canDel: z.boolean().optional(),
    }),
  ),
  events: z.array(z.looseObject({ id: z.string() })),
  clients: z.array(z.looseObject({ id: z.string() })).optional(),
  circuits: z.array(z.looseObject({ id: z.string() })).optional(),
  factu: z.object({ tva: z.number(), societe: z.string(), etabs: z.record(z.string(), z.string()) }).optional(),
});

export interface ImportedData {
  settings: Settings;
  drivers: { id: string; name: string; canAdd: boolean; canDelete: boolean }[];
  clients: Client[];
  circuits: Circuit[];
  events: Omit<AgendaEvent, 'client'>[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structure historique non typée, validée en sortie par le schéma d'import
type Legacy = any;

function legacyRun(circ: Legacy): Run {
  return {
    period: circ.sens as Period,
    ...(circ.trip ? { tripId: circ.trip } : {}),
    riders: (circ.jeunes ?? []).map((j: Legacy) => ({
      name: j.n,
      ...(j.l ? { label: j.l } : {}),
      ...(j.p != null ? { price: Number(j.p) || 0 } : {}),
      absent: !!j.abs,
    })),
    ...(circ.prix != null ? { price: Number(circ.prix) || 0 } : {}),
    ...(circ.supp != null ? { surcharge: Number(circ.supp) || 0 } : {}),
    ...(circ.verif != null ? { needsReview: !!circ.verif } : {}),
  };
}

function legacyConfig(c: Legacy): CircuitConfig {
  const plan: CircuitConfig['plan'] = {};
  for (const [key, slot] of Object.entries<Legacy>(c.plan ?? {})) {
    plan[key] = {
      riders: slot.jeunes ?? [],
      price: Number(slot.p) || 0,
      surcharge: Number(slot.s) || 0,
      ...(slot.h ? { hours: slot.h } : {}),
    };
  }
  const rates: CircuitConfig['rates'] = {};
  for (const [key, rate] of Object.entries<Legacy>(c.tarifs ?? {})) {
    rates[key] = { price: Number(rate.p) || 0, surcharge: Number(rate.s) || 0 };
  }
  return {
    ...emptyCircuitConfig(),
    ...(c.src ? { source: c.src } : {}),
    ...(c.notes ? { notes: c.notes } : {}),
    ...(c.forfait != null ? { flatRate: Number(c.forfait) } : {}),
    hours: c.h ?? {},
    stops: c.etapes ?? [],
    rates,
    plan,
    conventionRates: (c.prest ?? []).map((p: Legacy) => ({
      name: p.n,
      weekday: p.wd,
      label: p.l ?? '',
      price: Number(p.p) || 0,
    })),
    trips: (c.trips ?? []).map((t: Legacy) => ({
      id: t.id,
      weekday: t.wd,
      start: t.t,
      end: t.e,
      driverId: t.ag || null,
      title: t.txt,
      riders: (t.j ?? []).map((r: Legacy) => ({ name: r.n, label: r.l ?? '' })),
    })),
    series: c.ser ?? {},
  };
}

/** Convertit une sauvegarde de l'ancienne application. Lève une `ZodError` si le fichier n'en est pas une. */
export function parseLegacyBackup(raw: unknown): ImportedData {
  const data = legacyBackupSchema.parse(raw) as Legacy;
  const driverIds = new Set<string>(data.agendas.map((a: Legacy) => a.id));
  const clientIds = new Set<string>((data.clients ?? []).map((c: Legacy) => c.id));
  const circuitIds = new Set<string>((data.circuits ?? []).map((c: Legacy) => c.id));
  const firstLine = (s: string, fallback: string) => s.split('\n')[0]?.trim() || fallback;

  return {
    settings: {
      companyName: data.name || 'Taxi CRM',
      vatPercent: data.factu?.tva ?? 10,
      companyAddress: data.factu?.societe ?? '',
      establishments: Object.entries<string>(data.factu?.etabs ?? {}).map(([id, address]) => ({
        id,
        label: firstLine(address, id),
        address,
      })),
    },
    drivers: data.agendas.map((a: Legacy) => ({
      id: a.id,
      name: a.name,
      canAdd: !!a.canAdd,
      canDelete: !!a.canDel,
    })),
    clients: (data.clients ?? []).map((c: Legacy) => ({
      id: c.id,
      nom: c.nom ?? '',
      prenom: c.prenom ?? '',
      tel: c.tel ?? '',
      address: c.adresse ?? '',
      notes: c.notes ?? '',
    })),
    circuits: (data.circuits ?? []).map((c: Legacy) => ({
      id: c.id,
      name: c.name,
      establishmentId: c.etab,
      mode: c.mode === 'jeune' ? 'per_rider' : 'per_run',
      driverId: c.agenda && driverIds.has(c.agenda) ? c.agenda : null,
      color: c.color,
      config: legacyConfig(c),
    })),
    events: data.events
      // une course dont le chauffeur a disparu n'est rattachable à aucun agenda
      .filter((e: Legacy) => driverIds.has(e.agenda))
      .map((e: Legacy) => ({
        id: e.id,
        driverId: e.agenda,
        date: e.date,
        start: e.start,
        end: e.end,
        title: e.title,
        notes: e.notes ?? '',
        color: e.color,
        clientId: e.clientId && clientIds.has(e.clientId) ? e.clientId : null,
        seriesId: e.series ?? null,
        status: e.status ?? null,
        statusBy: e.statusBy ?? null,
        circuitId: e.circ && circuitIds.has(e.circ.id) ? e.circ.id : null,
        run: e.circ && circuitIds.has(e.circ.id) ? legacyRun(e.circ) : null,
      })),
  };
}
