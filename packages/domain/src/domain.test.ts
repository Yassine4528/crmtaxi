import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  applyPresence,
  billingSummary,
  buildMemo,
  circuitPeriods,
  easter,
  emptyCircuitConfig,
  excludingVat,
  fromIso,
  integerInWords,
  isHoliday,
  isoWeek,
  monthTotal,
  normalize,
  parseAmount,
  parseLegacyBackup,
  parseRiderNames,
  parseTripRiders,
  planRuns,
  propagateCircuitChange,
  rateFor,
  recurrenceDates,
  ridersKey,
  round2,
  runAmount,
  toIso,
  type AgendaEvent,
  type Circuit,
  type Settings,
} from './index.ts';

const counter = () => {
  let i = 0;
  return () => `id${++i}`;
};

const perRun = (over: Partial<Circuit['config']> = {}): Circuit => ({
  id: 'c1',
  name: 'Ligne A',
  establishmentId: 'e1',
  mode: 'per_run',
  driverId: 'd1',
  color: '#8cc4ee',
  config: {
    ...emptyCircuitConfig(),
    hours: { matin: [450, 540], soir: [960, 1050] },
    rates: { 'matin|alice,bob': { price: 40, surcharge: 5 } },
    plan: {
      '1matin': { riders: ['Alice', 'Bob'], price: 40, surcharge: 5 },
      '1soir': { riders: ['Alice'], price: 0, surcharge: 0 },
    },
    ...over,
  },
});

const perRider = (): Circuit => ({
  id: 'c2',
  name: 'Transport B',
  establishmentId: 'e1',
  mode: 'per_rider',
  driverId: null,
  color: '#ffb380',
  config: {
    ...emptyCircuitConfig(),
    hours: { jour: [720, 780] },
    conventionRates: [
      { name: 'Alice', weekday: 1, label: '', price: 30 },
      { name: 'Bob', weekday: 1, label: 'matin', price: 20 },
    ],
    trips: [
      {
        id: 't1',
        weekday: 1,
        start: 540,
        end: 570,
        driverId: 'd1',
        title: 'Aller',
        riders: [
          { name: 'Alice', label: '' },
          { name: 'Bob', label: 'matin' },
        ],
      },
      {
        id: 't2',
        weekday: 1,
        start: 900,
        end: 930,
        driverId: 'd2',
        title: 'Retour',
        riders: [{ name: 'Alice', label: '' }],
      },
      { id: 't3', weekday: 1, start: 1000, end: 1010, driverId: null, title: 'Sans chauffeur', riders: [] },
    ],
  },
});

const settings: Settings = {
  companyName: 'Démo',
  vatPercent: 10,
  companyAddress: 'Société démo',
  establishments: [{ id: 'e1', label: 'Établissement 1', address: 'Adresse 1' }],
};

describe('dates', () => {
  it('calcule Pâques et les jours fériés français', () => {
    expect(toIso(easter(2026))).toBe('2026-04-05');
    expect(isHoliday(fromIso('2026-04-06'))).toBe(true); // lundi de Pâques
    expect(isHoliday(fromIso('2026-05-14'))).toBe(true); // Ascension
    expect(isHoliday(fromIso('2026-05-25'))).toBe(true); // Pentecôte
    expect(isHoliday(fromIso('2026-11-11'))).toBe(true);
    expect(isHoliday(fromIso('2026-11-10'))).toBe(false);
  });

  it('donne le numéro de semaine ISO', () => {
    expect(isoWeek(fromIso('2026-01-01'))).toBe(1);
    expect(isoWeek(fromIso('2027-01-03'))).toBe(53);
  });

  it('gère une récurrence une semaine sur deux, y compris au passage à l’heure d’hiver', () => {
    const dates = recurrenceDates(fromIso('2026-10-19'), fromIso('2026-11-16'), 2, [1], 100);
    expect(dates).toEqual(['2026-10-19', '2026-11-02', '2026-11-16']);
  });

  it('respecte le nombre maximum de répétitions', () => {
    expect(recurrenceDates(fromIso('2026-10-19'), fromIso('2030-01-01'), 1, [1, 3], 3)).toHaveLength(3);
  });
});

describe('montants', () => {
  it('arrondit au centime et lit la saisie française', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(parseAmount('1 234,50')).toBe(1234.5);
    expect(parseAmount('abc')).toBe(0);
    expect(excludingVat(55, 10)).toBe(50);
  });

  it.each([
    [0, 'zéro'],
    [21, 'vingt et un'],
    [71, 'soixante et onze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [97, 'quatre-vingt-dix-sept'],
    [200, 'deux cents'],
    [1000, 'mille'],
    [80000, 'quatre-vingt mille'],
    [1234, 'mille deux cent trente-quatre'],
    [2000000, 'deux millions'],
  ])('écrit %i en lettres', (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it('écrit un montant en euros et centimes', () => {
    expect(amountInWords(1)).toBe('un euro');
    expect(amountInWords(55.5)).toBe('cinquante-cinq euros et cinquante centimes');
    expect(amountInWords(2.01)).toBe('deux euros et un centime');
  });
});

describe('texte', () => {
  it('compare sans casse ni accents', () => {
    expect(normalize('  Élodie ')).toBe('elodie');
    expect(ridersKey(['Bob', 'Élodie'])).toBe(ridersKey(['elodie', 'BOB']));
  });

  it('analyse les listes de jeunes', () => {
    expect(parseRiderNames('ana - Leo -Mia + leo')).toEqual(['Ana', 'Leo', 'Mia']);
    expect(parseRiderNames('Pas de transport')).toEqual([]);
    expect(parseTripRiders('Zoé (matin), Tom')).toEqual([
      { name: 'Zoé', label: 'matin' },
      { name: 'Tom', label: '' },
    ]);
  });
});

describe('tarifs', () => {
  it('retrouve un tarif déjà facturé, dans l’autre sens au besoin', () => {
    const c = perRun();
    expect(rateFor(c, 'soir', ['bob', 'ALICE'])).toEqual({ price: 40, surcharge: 5 });
    expect(rateFor(c, 'matin', ['Inconnu'])).toBeNull();
  });

  it('applique le forfait, et 0 € sans enfant', () => {
    const c = perRun({ flatRate: 55 });
    expect(rateFor(c, 'matin', ['X', 'Y', 'Z'])).toEqual({ price: 55, surcharge: 0 });
    expect(rateFor(c, 'matin', [])).toEqual({ price: 0, surcharge: 0 });
  });

  it('ne facture pas une course annulée', () => {
    const run = { period: 'matin' as const, riders: [], price: 40, surcharge: 5 };
    expect(runAmount({ status: null, run }, 'per_run')).toBe(45);
    expect(runAmount({ status: 'annule', run }, 'per_run')).toBe(0);
  });
});

describe('périodes', () => {
  it('suivent l’ordre de la journée, quel que soit l’ordre des clés stockées', () => {
    expect(circuitPeriods({ hours: { soir: [960, 1050], matin: [450, 540], midi: [720, 780] } })).toEqual([
      'matin',
      'midi',
      'soir',
    ]);
  });
});

describe('création des courses', () => {
  it('ignore les week-ends et jours fériés, et n’écrase rien', () => {
    const c = perRun();
    // 9 → 16 novembre 2026 : deux lundis
    const first = planRuns(c, '2026-11-09', '2026-11-16', [], counter());
    expect(first.events.map((e) => e.date)).toEqual(['2026-11-09', '2026-11-09', '2026-11-16', '2026-11-16']);
    expect(first.events[0]!.run!.needsReview).toBe(false);
    expect(first.events[1]!.run!.needsReview).toBe(true); // tarif inconnu → à vérifier
    expect(first.events[0]!.seriesId).toBe(first.events[2]!.seriesId);

    const second = planRuns(c, '2026-11-09', '2026-11-16', first.events, counter());
    expect(second.events).toHaveLength(0);
    expect(second.skipped).toBe(4);

    // le 11 novembre tombe un mercredi : aucune course ce jour-là même avec un planning
    const holiday = perRun({ plan: { '3matin': { riders: ['A'], price: 1, surcharge: 0 } } });
    expect(planRuns(holiday, '2026-11-11', '2026-11-11', [], counter()).events).toHaveLength(0);
  });

  it('ne crée rien pour un circuit sans chauffeur', () => {
    const c = { ...perRun(), driverId: null };
    expect(planRuns(c, '2026-11-09', '2026-11-09', [], counter()).events).toHaveLength(0);
  });

  it('crée une course par trajet attribué, chez le bon chauffeur', () => {
    const { events } = planRuns(perRider(), '2026-11-09', '2026-11-09', [], counter());
    expect(events.map((e) => [e.driverId, e.run!.tripId])).toEqual([
      ['d1', 't1'],
      ['d2', 't2'],
    ]);
    expect(events[0]!.run!.riders.map((r) => r.price)).toEqual([30, 20]);
  });
});

describe('présences', () => {
  const event = {
    date: '2026-11-09',
    run: {
      period: 'matin' as const,
      riders: [
        { name: 'Alice', absent: false },
        { name: 'Bob', absent: false },
      ],
      price: 40,
      surcharge: 5,
    },
  };

  it('un chauffeur déclenche une vérification sur une combinaison jamais facturée', () => {
    const { run, learnedRate } = applyPresence(
      event,
      perRun(),
      {
        riders: [
          { name: 'Alice', absent: false },
          { name: 'Bob', absent: true },
        ],
      },
      false,
    );
    expect(run.needsReview).toBe(true);
    expect(learnedRate).toBeNull();
  });

  it('un chauffeur ne peut pas fixer un montant', () => {
    const { run } = applyPresence(
      event,
      perRun(),
      {
        riders: [
          { name: 'Alice', absent: false, price: 9999 },
          { name: 'Bob', absent: false },
        ],
        price: 9999,
      },
      false,
    );
    expect(run.price).toBe(40);
    expect(run.riders[0]!.price).toBeUndefined();
  });

  it('une course sans jeune passe à 0 €', () => {
    const { run } = applyPresence(event, perRun(), { riders: [{ name: 'Alice', absent: true }] }, false);
    expect(run.price).toBe(0);
    expect(run.needsReview).toBe(false);
  });

  it('le montant saisi par le gérant fait foi et devient le tarif', () => {
    const { run, learnedRate } = applyPresence(
      event,
      perRun(),
      {
        riders: [
          { name: 'Alice', absent: false },
          { name: 'Bob', absent: false },
        ],
        price: 42,
        surcharge: 1,
        manualPrice: true,
      },
      true,
    );
    expect(run.price).toBe(42);
    expect(learnedRate).toEqual({ key: 'matin|alice,bob', rate: { price: 42, surcharge: 1 } });
  });
});

describe('propagation des changements de circuit', () => {
  const event: AgendaEvent = {
    id: 'e1',
    driverId: 'd1',
    date: '2026-11-09',
    start: 450,
    end: 540,
    title: 'x',
    notes: '',
    color: '#fff',
    seriesId: null,
    status: null,
    statusBy: null,
    circuitId: 'c1',
    run: { period: 'matin', riders: [{ name: 'Alice', absent: false }], price: 0, surcharge: 0, needsReview: true },
  };

  it('décale les courses à l’ancien horaire et laisse celles déplacées à la main', () => {
    const before = perRun();
    const after = perRun({ hours: { matin: [460, 550], soir: [960, 1050] } });
    const moved = { ...event, id: 'e2', start: 500, end: 560 };
    const changed = propagateCircuitChange(before, after, [event, moved]);
    expect(changed.map((e) => [e.id, e.start, e.end])).toEqual([['e1', 460, 550]]);
  });

  it('reprend le tarif quand il devient connu', () => {
    const before = perRun();
    const after = perRun({ rates: { 'matin|alice': { price: 25, surcharge: 0 } } });
    const [changed] = propagateCircuitChange(before, after, [event]);
    expect(changed!.run).toMatchObject({ price: 25, needsReview: false });
  });
});

describe('facturation', () => {
  const run = (date: string, riders: { name: string; price?: number; absent?: boolean; label?: string }[]) =>
    ({
      id: `${date}-${riders.length}`,
      driverId: 'd1',
      date,
      start: 500,
      status: null,
      circuitId: 'c2',
      run: {
        period: 'jour',
        riders: riders.map((r) => ({ ...r, absent: !!r.absent })),
      },
    }) as const;

  it('ne compte un jeune qu’une fois par jour, au tarif le plus élevé', () => {
    const c = perRider();
    const runs = [
      run('2026-11-09', [{ name: 'Alice', price: 30 }]),
      run('2026-11-09', [{ name: 'alice', price: 18 }]),
      run('2026-11-16', [{ name: 'Alice', price: 30, absent: true }]),
    ];
    expect(monthTotal(c, runs as never)).toBe(30);
  });

  it('produit un mémoire cohérent', () => {
    const c = perRider();
    const memo = buildMemo(
      c,
      [run('2026-11-09', [{ name: 'Alice', price: 30 }]), run('2026-11-16', [{ name: 'Alice', price: 30 }])] as never,
      settings,
      '2026-11',
    )!;
    expect(memo.ttc).toBe(60);
    expect(memo.riderLines).toHaveLength(1);
    expect(memo.riderLines[0]).toMatchObject({ quantity: 2, dates: [9, 16] });
    expect(memo.amountInWords).toBe('soixante euros');
    expect(buildMemo(c, [], settings, '2026-11')).toBeNull();
  });

  it('résume par établissement avec HT et TVA', () => {
    const c = perRun();
    const [section] = billingSummary(
      [c],
      [
        {
          id: 'a',
          driverId: 'd1',
          date: '2026-11-09',
          start: 450,
          status: null,
          circuitId: 'c1',
          run: { period: 'matin', riders: [{ name: 'A', absent: false }], price: 50, surcharge: 5, needsReview: true },
        },
      ],
      settings,
      '2026-11',
    );
    expect(section).toMatchObject({ ttc: 55, ht: 50, vat: 5 });
    expect(section!.rows[0]!.needsReview.count).toBe(1);
  });
});

describe('import de l’ancienne application', () => {
  const legacy = {
    name: 'Société démo',
    adminPin: '123456',
    agendas: [{ id: 'a1', name: 'Chauffeur', on: true, pin: 'secret', canAdd: true }],
    clients: [{ id: 'cl1', nom: 'DUPONT', prenom: 'Paul', tel: '01', adresse: 'Rue', notes: '' }],
    factu: { tva: 10, societe: 'Société', etabs: { x: 'ÉTAB X\nAdresse' } },
    circuits: [
      {
        id: 'c1',
        name: 'Ligne',
        etab: 'x',
        mode: 'course',
        agenda: 'a1',
        color: '#fff',
        h: { matin: [1, 2] },
        tarifs: { 'matin|a': { p: 10, s: 1 } },
        plan: { '1matin': { jeunes: ['A'], p: 10, s: 1 } },
        ser: { matin: 's1' },
      },
    ],
    events: [
      {
        id: 'e1',
        agenda: 'a1',
        date: '2026-11-09',
        start: 1,
        end: 2,
        title: 'Course',
        notes: '',
        color: '#fff',
        series: 's1',
        _l: 0,
        _n: 1,
        circ: { id: 'c1', sens: 'matin', jeunes: [{ n: 'A', abs: true }], prix: 10, supp: 1, verif: false },
      },
      { id: 'orphan', agenda: 'disparu', date: '2026-11-09', start: 1, end: 2, title: 'x', color: '#fff' },
    ],
  };

  it('convertit le format historique sans reprendre les codes en clair', () => {
    const out = parseLegacyBackup(legacy);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(JSON.stringify(out)).not.toContain('123456');
    expect(out.settings.establishments[0]).toMatchObject({ id: 'x', label: 'ÉTAB X' });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ driverId: 'a1', circuitId: 'c1', seriesId: 's1' });
    expect(out.events[0]!.run).toEqual({
      period: 'matin',
      riders: [{ name: 'A', absent: true }],
      price: 10,
      surcharge: 1,
      needsReview: false,
    });
    expect(out.events[0]).not.toHaveProperty('_l');
    expect(out.circuits[0]).toMatchObject({ mode: 'per_run', driverId: 'a1' });
    expect(out.circuits[0]!.config.plan['1matin']).toEqual({ riders: ['A'], price: 10, surcharge: 1 });
  });

  it('refuse un fichier qui n’est pas une sauvegarde', () => {
    expect(() => parseLegacyBackup({ foo: 1 })).toThrow();
  });
});
