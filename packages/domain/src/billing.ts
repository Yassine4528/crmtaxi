import { fromIso, memoDate } from './dates.ts';
import { presentRiders, riderCount, runAmount } from './circuits.ts';
import { amountInWords, excludingVat, round2 } from './money.ts';
import {
  PERIOD_LABELS,
  PERIOD_ORDER,
  STATUS_LABELS,
  type AgendaEvent,
  type BillingSection,
  type Circuit,
  type Memo,
  type MemoRiderLine,
  type MemoRunLine,
  type Settings,
} from './schemas.ts';
import { normalize } from './text.ts';

type BillableEvent = Pick<AgendaEvent, 'id' | 'date' | 'start' | 'status' | 'run' | 'circuitId' | 'driverId'>;

export function monthRuns<E extends BillableEvent>(events: E[], circuitId: string, month: string): E[] {
  return events
    .filter((e) => e.circuitId === circuitId && e.run && e.date.startsWith(month))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || PERIOD_ORDER[a.run!.period] - PERIOD_ORDER[b.run!.period] || a.start - b.start,
    );
}

export interface RiderDay {
  name: string;
  label: string;
  price: number;
  weekday: number;
  day: number;
}

/**
 * Facturation par jeune : présent sur au moins un trajet du jour, il compte une fois,
 * au tarif le plus élevé de sa convention pour ce jour.
 */
export function riderDays(runs: BillableEvent[]): RiderDay[] {
  const seen = new Map<string, RiderDay>();
  for (const event of runs) {
    if (event.status || !event.run) continue;
    const d = fromIso(event.date);
    for (const rider of presentRiders(event.run)) {
      const price = rider.price ?? 0;
      if (!price) continue;
      const key = `${event.date}|${normalize(rider.name)}|${rider.label ?? ''}`;
      const current = seen.get(key);
      if (!current || price > current.price) {
        seen.set(key, { name: rider.name, label: rider.label ?? '', price, weekday: d.getDay(), day: d.getDate() });
      }
    }
  }
  return [...seen.values()];
}

export function monthTotal(circuit: Circuit, runs: BillableEvent[]): number {
  if (circuit.mode === 'per_rider') return round2(riderDays(runs).reduce((sum, x) => sum + x.price, 0));
  return round2(runs.reduce((sum, e) => sum + runAmount(e, circuit.mode), 0));
}

export function billingSummary(
  circuits: Circuit[],
  events: BillableEvent[],
  settings: Settings,
  month: string,
): BillingSection[] {
  const vat = settings.vatPercent;
  const sections: BillingSection[] = [];
  for (const establishment of settings.establishments) {
    const mine = circuits.filter((c) => c.establishmentId === establishment.id);
    if (!mine.length) continue;
    let sum = 0;
    const rows = mine.map((circuit) => {
      const runs = monthRuns(events, circuit.id, month);
      const ttc = monthTotal(circuit, runs);
      const review = runs.filter((e) => e.run!.needsReview);
      sum = round2(sum + ttc);
      const ht = excludingVat(ttc, vat);
      return {
        circuitId: circuit.id,
        name: circuit.name,
        runCount: runs.length,
        needsReview: {
          count: review.length,
          firstEventId: review[0]?.id ?? null,
          firstDate: review[0]?.date ?? null,
          firstDriverId: review[0]?.driverId ?? null,
        },
        ttc,
        ht,
        vat: round2(ttc - ht),
      };
    });
    const ht = excludingVat(sum, vat);
    sections.push({
      establishmentId: establishment.id,
      label: establishment.label,
      rows,
      ttc: sum,
      ht,
      vat: round2(sum - ht),
    });
  }
  return sections;
}

/** Mémoire mensuel d'un circuit, au format attendu par les établissements. `null` s'il n'y a aucune course. */
export function buildMemo(circuit: Circuit, events: BillableEvent[], settings: Settings, month: string): Memo | null {
  const runs = monthRuns(events, circuit.id, month);
  if (!runs.length) return null;
  const vatPercent = settings.vatPercent;
  const stops = circuit.config.stops;
  let total = 0;
  const runLines: MemoRunLine[] = [];
  const riderLines: MemoRiderLine[] = [];

  if (circuit.mode === 'per_run') {
    for (const event of runs) {
      const run = event.run!;
      const amount = runAmount(event, circuit.mode);
      const names = presentRiders(run).map((r) => r.name);
      total = round2(total + amount);
      runLines.push({
        date: memoDate(fromIso(event.date)),
        period: PERIOD_LABELS[run.period],
        riderCount: event.status ? 0 : riderCount(run, stops),
        riders: event.status ? STATUS_LABELS[event.status] : names.length ? names.join(' - ') : 'Pas de transport',
        surcharge: !event.status && run.surcharge ? run.surcharge : null,
        amount,
      });
    }
  } else {
    // une ligne par jeune, jour et tarif, avec la liste des dates de présence
    const groups = new Map<string, Omit<RiderDay, 'day'> & { dates: number[] }>();
    for (const day of riderDays(runs)) {
      const key = `${day.name}|${day.weekday}|${day.label}|${day.price}`;
      const group = groups.get(key) ?? { ...day, dates: [] };
      group.dates.push(day.day);
      groups.set(key, group);
    }
    const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.weekday - b.weekday);
    for (const group of sorted) {
      const ttc = round2(group.price * group.dates.length);
      total = round2(total + ttc);
      riderLines.push({
        name: group.name,
        weekday: group.weekday,
        label: group.label,
        dates: group.dates,
        unitHt: excludingVat(group.price, vatPercent),
        quantity: group.dates.length,
        ht: excludingVat(ttc, vatPercent),
        ttc,
      });
    }
  }

  const ht = excludingVat(total, vatPercent);
  return {
    circuitName: circuit.name,
    mode: circuit.mode,
    establishmentAddress: settings.establishments.find((e) => e.id === circuit.establishmentId)?.address ?? '',
    companyAddress: settings.companyAddress,
    month,
    runLines,
    riderLines,
    ttc: total,
    ht,
    vat: round2(total - ht),
    vatPercent,
    amountInWords: amountInWords(total),
  };
}
