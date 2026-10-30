import { PERIOD_LABELS, presentRiders, riderCount, type AgendaEvent } from '@taxi-crm/domain';
import type { CircuitIndex } from '../api/hooks.ts';

/** Courses d'une même demi-journée regroupées en un bloc, pour la vue chauffeur. */
export interface TourGroup {
  id: string;
  group: AgendaEvent[];
  date: string;
  driverId: string;
  start: number;
  end: number;
  title: string;
  color: string;
  seriesId: string | null;
  status: null;
}

export type GridItem = AgendaEvent | TourGroup;

export const isGroup = (item: GridItem): item is TourGroup => 'group' in item;

/**
 * Vue chauffeur : lignes et circuits forment un bloc par jour et demi-journée — « Ligne scolaire » ou
 * « Tournée scolaire » ; le détail et les présences restent accessibles au clic. Le gérant voit chaque course.
 */
export function groupTours(list: AgendaEvent[], isAdmin: boolean, circuits: CircuitIndex): GridItem[] {
  if (isAdmin) return list.slice();
  const out: GridItem[] = [];
  const groups = new Map<string, TourGroup>();
  for (const event of list) {
    const circuit = event.circuitId ? circuits.get(event.circuitId) : undefined;
    if (!circuit || circuit.mode !== 'per_run' || !event.run) {
      out.push(event);
      continue;
    }
    const label = /^ligne/i.test(circuit.source ?? circuit.name) ? 'Ligne scolaire' : 'Tournée scolaire';
    const key = `${event.date}|${event.driverId}|${event.run.period}|${label}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: `grp:${key}`,
        group: [],
        date: event.date,
        driverId: event.driverId,
        start: event.start,
        end: event.end,
        title: `${label} · ${PERIOD_LABELS[event.run.period]}`,
        color: '#c9dbe8',
        seriesId: event.seriesId,
        status: null,
      };
      groups.set(key, group);
      out.push(group);
    }
    group.group.push(event);
    group.start = Math.min(group.start, event.start);
    group.end = Math.max(group.end, event.end);
  }
  return out;
}

export function itemText(item: GridItem, isAdmin: boolean, circuits: CircuitIndex): string {
  if (isGroup(item)) return (isAdmin && item.group.some((e) => e.run?.needsReview) ? '⚠ ' : '') + item.title;
  const run = item.run;
  if (!run) return item.title + (item.notes ? `\n${item.notes}` : '');
  const present = presentRiders(run);
  const absent = run.riders.filter((r) => r.absent);
  const stops = (item.circuitId && circuits.get(item.circuitId)?.stops) || [];
  return (
    (run.needsReview && isAdmin ? '⚠ ' : '') +
    `${item.title} (${riderCount(run, stops)})\n` +
    (present.length ? present.map((r) => r.name).join(' - ') : 'Pas de transport') +
    (absent.length ? `\nAbs : ${absent.map((r) => r.name).join(', ')}` : '')
  );
}

export interface LaneInfo {
  lane: number;
  lanes: number;
}

/** Répartit les éléments qui se chevauchent en colonnes côte à côte. */
export function layoutOverlaps<T extends { id: string; start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const positions = new Map<string, LaneInfo>();
  let group: T[] = [];
  let lanes: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    group.forEach((item) => {
      positions.get(item.id)!.lanes = lanes.length;
    });
    group = [];
    lanes = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    let lane = lanes.findIndex((end) => end <= item.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = item.end;
    positions.set(item.id, { lane, lanes: 1 });
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return { sorted, positions };
}
