import { addDays, fromIso, isHoliday, toIso } from './dates.ts';
import { round2 } from './money.ts';
import { PERIOD_ORDER } from './schemas.ts';
import type { AgendaEvent, Circuit, CircuitConfig, Period, Rate, Rider, Run, Slot } from './schemas.ts';
import { normalize, ridersKey } from './text.ts';

export const DEFAULT_COURSE_COLORS = ['#8cc4ee', '#8fd19e', '#f6c443', '#d9a8e8', '#f2a0a0', '#ffb380'];
export const WORK_WEEKDAYS = [1, 2, 3, 4, 5];

export const emptyCircuitConfig = (): CircuitConfig => ({
  hours: {},
  stops: [],
  rates: {},
  plan: {},
  conventionRates: [],
  trips: [],
  series: {},
});

export const presentRiders = (run: Run): Rider[] => run.riders.filter((r) => !r.absent);

/** Nombre de jeunes présents, sans les étapes (« Lycée »…) notées dans la liste. */
export function riderCount(run: Run, stops: string[]): number {
  const excluded = stops.map(normalize);
  return presentRiders(run).filter((r) => !excluded.includes(normalize(r.name))).length;
}

/** Tarif applicable à une combinaison de jeunes : forfait, sinon tarif déjà facturé (même sens de préférence). */
export function rateFor(circuit: Circuit, period: Period, names: string[]): Rate | null {
  if (circuit.mode !== 'per_run') return null;
  const { flatRate, rates } = circuit.config;
  if (flatRate != null) return { price: names.length ? flatRate : 0, surcharge: 0 };
  const key = ridersKey(names);
  const other = period === 'matin' ? 'soir' : 'matin';
  return rates[`${period}|${key}`] ?? rates[`${other}|${key}`] ?? null;
}

export function conventionPrice(circuit: Circuit, name: string, weekday: number, label: string): number {
  const rate = circuit.config.conventionRates.find(
    (r) => normalize(r.name) === normalize(name) && r.weekday === weekday && (r.label || '') === (label || ''),
  );
  return rate ? rate.price : 0;
}

/** Montant TTC d'une course : 0 si elle est annulée ou marquée absente. */
export function runAmount(event: Pick<AgendaEvent, 'status' | 'run'>, mode: Circuit['mode'] | undefined): number {
  const run = event.run;
  if (event.status || !run) return 0;
  if (mode === 'per_rider') return round2(presentRiders(run).reduce((sum, r) => sum + (r.price ?? 0), 0));
  return round2((run.price ?? 0) + (run.surcharge ?? 0));
}

export const planKey = (weekday: number, period: Period): string => `${weekday}${period}`;

/** Périodes d'un circuit dans l'ordre de la journée : l'ordre des clés d'un JSON stocké n'est pas garanti. */
export const circuitPeriods = (config: Pick<CircuitConfig, 'hours'>): Period[] =>
  (Object.keys(config.hours) as Period[]).sort((a, b) => PERIOD_ORDER[a] - PERIOD_ORDER[b]);

export interface PlannedRuns {
  events: Omit<AgendaEvent, 'client'>[];
  skipped: number;
  /** Identifiants de série éventuellement créés : à enregistrer dans le circuit. */
  series: Record<string, string>;
}

/**
 * Crée les courses du planning type sur une période, hors week-ends et jours fériés.
 * Sans effet de bord : les courses déjà présentes sont comptées dans `skipped`.
 */
export function planRuns(
  circuit: Circuit,
  from: string,
  to: string,
  existing: Pick<AgendaEvent, 'date' | 'circuitId' | 'run'>[],
  newId: () => string,
): PlannedRuns {
  const { config } = circuit;
  const series = { ...config.series };
  const seriesFor = (key: string): string => (series[key] ??= newId());
  const out: PlannedRuns['events'] = [];
  let skipped = 0;
  const mine = existing.filter((e) => e.circuitId === circuit.id);
  const hasTripRun = (date: string, tripId: string) =>
    mine.some((e) => e.date === date && e.run?.tripId === tripId) ||
    out.some((e) => e.date === date && e.run?.tripId === tripId);
  const hasPeriodRun = (date: string, period: Period) => mine.some((e) => e.date === date && e.run?.period === period);

  const base = (date: string, driverId: string, start: number, end: number, title: string, seriesKey: string) => ({
    id: newId(),
    driverId,
    date,
    start,
    end,
    title,
    notes: '',
    color: circuit.color,
    clientId: null,
    seriesId: seriesFor(seriesKey),
    status: null,
    statusBy: null,
    circuitId: circuit.id,
  });

  const usesTrips = circuit.mode === 'per_rider' && config.trips.length > 0;
  for (let d = fromIso(from); d <= fromIso(to); d = addDays(d, 1)) {
    const weekday = d.getDay();
    const date = toIso(d);
    if (weekday === 0 || weekday === 6 || isHoliday(d)) continue;

    if (usesTrips) {
      // une course par trajet, chez le chauffeur du trajet
      for (const trip of config.trips) {
        if (trip.weekday !== weekday || !trip.driverId) continue;
        if (hasTripRun(date, trip.id)) {
          skipped++;
          continue;
        }
        out.push({
          ...base(date, trip.driverId, trip.start, trip.end, trip.title, trip.id),
          run: {
            period: 'jour',
            tripId: trip.id,
            riders: trip.riders.map((r) => ({
              name: r.name,
              label: r.label,
              price: conventionPrice(circuit, r.name, weekday, r.label),
              absent: false,
            })),
          },
        });
      }
    } else if (circuit.mode === 'per_rider') {
      const rates = config.conventionRates.filter((r) => r.weekday === weekday);
      if (!rates.length || !circuit.driverId) continue;
      if (hasPeriodRun(date, 'jour')) {
        skipped++;
        continue;
      }
      const [start, end] = config.hours.jour ?? [720, 780];
      out.push({
        ...base(date, circuit.driverId, start, end, `${circuit.name} · journée`, 'jour'),
        run: {
          period: 'jour',
          riders: rates.map((r) => ({ name: r.name, label: r.label, price: r.price, absent: false })),
        },
      });
    } else {
      if (!circuit.driverId) continue;
      for (const period of circuitPeriods(config)) {
        const slot = config.plan[planKey(weekday, period)];
        if (!slot) continue;
        if (hasPeriodRun(date, period)) {
          skipped++;
          continue;
        }
        const [start, end] = slot.hours ?? config.hours[period]!;
        out.push({
          ...base(date, circuit.driverId, start, end, `${circuit.name} · ${periodLabel(period)}`, period),
          run: {
            period,
            riders: slot.riders.map((name) => ({ name, absent: false })),
            price: slot.price,
            surcharge: slot.surcharge,
            // sans tarif connu, la course est signalée à vérifier dans la facturation
            needsReview: !slot.price,
          },
        });
      }
    }
  }
  return { events: out, skipped, series };
}

const periodLabel = (p: Period): string => (p === 'jour' ? 'journée' : p);

export interface PresenceChange {
  run: Run;
  /** Tarif à mémoriser pour cette combinaison de jeunes, le cas échéant. */
  learnedRate: { key: string; rate: Rate } | null;
}

/** Enregistre les présences d'une course et en déduit le montant. Le montant saisi par le gérant fait foi. */
export function applyPresence(
  event: Pick<AgendaEvent, 'run' | 'date'>,
  circuit: Circuit | undefined,
  input: { riders: Rider[]; price?: number; surcharge?: number; manualPrice?: boolean },
  isAdmin: boolean,
): PresenceChange {
  const previous = event.run!;
  const weekday = fromIso(event.date).getDay();
  const riders: Rider[] = isAdmin
    ? input.riders
    : input.riders.map((r) => {
        // un chauffeur ne fixe jamais de prix : on garde celui de la course ou de la convention
        const known = previous.riders.find(
          (p) => normalize(p.name) === normalize(r.name) && (p.label ?? '') === (r.label ?? ''),
        );
        const fallback = circuit?.config.conventionRates.find((c) => normalize(c.name) === normalize(r.name));
        const price =
          known?.price ??
          (circuit ? conventionPrice(circuit, r.name, weekday, r.label ?? '') || fallback?.price : undefined);
        return { name: r.name, label: r.label, absent: r.absent, ...(price != null ? { price } : {}) };
      });

  const run: Run = { ...previous, riders };
  if (!circuit || circuit.mode !== 'per_run') return { run, learnedRate: null };

  const names = presentRiders(run).map((r) => r.name);
  const rate = rateFor(circuit, previous.period, names);
  if (isAdmin) {
    run.price = input.price ?? 0;
    run.surcharge = input.surcharge ?? 0;
    run.needsReview = false;
    const learn = names.length > 0 && (!rate || input.manualPrice) && circuit.config.flatRate == null;
    return {
      run,
      learnedRate: learn
        ? { key: `${previous.period}|${ridersKey(names)}`, rate: { price: run.price, surcharge: run.surcharge } }
        : null,
    };
  }
  if (rate) {
    run.price = rate.price;
    run.surcharge = rate.surcharge;
    run.needsReview = false;
  } else if (!names.length) {
    run.price = 0;
    run.surcharge = 0;
    run.needsReview = false;
  } else {
    run.needsReview = true; // combinaison jamais facturée : le gérant vérifie le montant
  }
  return { run, learnedRate: null };
}

const slotHours = (config: CircuitConfig, slot: Slot | undefined, period: Period) =>
  slot?.hours ?? config.hours[period];

/**
 * Répercute une modification du circuit sur ses courses à venir : horaires décalés quand la course était
 * à l'ancien horaire, montants repris quand la combinaison de jeunes a un tarif connu.
 * Retourne uniquement les courses modifiées.
 */
export function propagateCircuitChange<E extends Pick<AgendaEvent, 'id' | 'date' | 'start' | 'end' | 'run'>>(
  before: Circuit,
  after: Circuit,
  futureEvents: E[],
): E[] {
  if (after.mode !== 'per_run') return [];
  const changed = new Map<string, E>();
  for (const event of futureEvents) {
    const run = event.run;
    if (!run || run.tripId) continue;
    const weekday = fromIso(event.date).getDay();
    const key = planKey(weekday, run.period);
    const oldHours = slotHours(before.config, before.config.plan[key], run.period);
    const newHours = slotHours(after.config, after.config.plan[key], run.period);
    let next = event;
    if (oldHours && newHours && event.start === oldHours[0] && event.end === oldHours[1]) {
      if (newHours[0] !== oldHours[0] || newHours[1] !== oldHours[1]) {
        next = { ...next, start: newHours[0], end: newHours[1] };
      }
    }
    const rate = rateFor(
      after,
      run.period,
      presentRiders(run).map((r) => r.name),
    );
    if (rate && (run.price !== rate.price || (run.surcharge ?? 0) !== rate.surcharge || run.needsReview)) {
      next = { ...next, run: { ...run, price: rate.price, surcharge: rate.surcharge, needsReview: false } };
    }
    if (next !== event) changed.set(event.id, next);
  }
  return [...changed.values()];
}
