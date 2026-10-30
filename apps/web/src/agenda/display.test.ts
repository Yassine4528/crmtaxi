import type { AgendaEvent } from '@taxi-crm/domain';
import { describe, expect, it } from 'vitest';
import type { CircuitIndex } from '../api/hooks.ts';
import { groupTours, isGroup, itemText, layoutOverlaps } from './display.ts';

const event = (over: Partial<AgendaEvent>): AgendaEvent => ({
  id: 'e',
  driverId: 'd',
  date: '2026-11-09',
  start: 480,
  end: 540,
  title: 'Course',
  notes: '',
  color: '#fff',
  seriesId: null,
  status: null,
  statusBy: null,
  circuitId: null,
  run: null,
  ...over,
});

const circuits: CircuitIndex = new Map([
  ['l', { id: 'l', name: 'Ligne 1', mode: 'per_run', color: '#fff', stops: ['Lycée'] }],
  ['c', { id: 'c', name: 'Circuit X', mode: 'per_run', color: '#fff', stops: [] }],
  ['j', { id: 'j', name: 'Transport', mode: 'per_rider', color: '#fff', stops: [] }],
]);

describe('layoutOverlaps', () => {
  it('met côte à côte les chevauchements, sans modifier les événements', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 100, end: 120 },
    ];
    const frozen = JSON.stringify(items);
    const { positions } = layoutOverlaps(items);
    expect(positions.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(positions.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(positions.get('c')).toEqual({ lane: 0, lanes: 1 });
    expect(JSON.stringify(items)).toBe(frozen);
  });
});

describe('groupTours', () => {
  const run = (period: 'matin' | 'soir') => ({ period, riders: [{ name: 'Alice', absent: false }] });
  const list = [
    event({ id: '1', circuitId: 'l', run: run('matin'), start: 450, end: 500 }),
    event({ id: '2', circuitId: 'l', run: run('matin'), start: 480, end: 540 }),
    event({ id: '3', circuitId: 'c', run: run('matin') }),
    event({ id: '4', circuitId: 'j', run: { period: 'jour', riders: [] } }),
    event({ id: '5' }),
  ];

  it('laisse le détail au gérant', () => {
    expect(groupTours(list, true, circuits)).toHaveLength(5);
  });

  it('regroupe lignes et circuits pour un chauffeur', () => {
    const out = groupTours(list, false, circuits);
    expect(out).toHaveLength(4);
    const line = out.find((i) => isGroup(i) && i.title.startsWith('Ligne'));
    expect(line).toMatchObject({ start: 450, end: 540 });
    expect(out.some((i) => isGroup(i) && i.title === 'Tournée scolaire · matin')).toBe(true);
  });
});

describe('itemText', () => {
  it('compte les jeunes sans les étapes et liste les absents', () => {
    const e = event({
      circuitId: 'l',
      run: {
        period: 'matin',
        needsReview: true,
        riders: [
          { name: 'Alice', absent: false },
          { name: 'Lycée', absent: false },
          { name: 'Bob', absent: true },
        ],
      },
    });
    expect(itemText(e, true, circuits)).toBe('⚠ Course (1)\nAlice - Lycée\nAbs : Bob');
    expect(itemText(e, false, circuits)).toBe('Course (1)\nAlice - Lycée\nAbs : Bob');
  });
});
