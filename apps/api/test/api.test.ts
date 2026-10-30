import { emptyCircuitConfig, type AgendaEvent, type Circuit } from '@taxi-crm/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { ADMIN_IDLE_MS, ensureAdmin, SESSION_COOKIE } from '../src/auth.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, type DbHandle } from '../src/db/client.ts';
import { auditLog, sessions, users } from '../src/db/schema.ts';

const ADMIN_PASSWORD = 'mot-de-passe-de-test';
const config: Config = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  PGLITE_DATA_DIR: '',
};

let handle: DbHandle;
let app: FastifyInstance;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, body?: unknown) {
  return app.inject({
    method,
    url,
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
    ...(body !== undefined ? { payload: body as object } : {}),
  });
}

async function signIn(login: string, password: string): Promise<string> {
  const res = await call('POST', '/api/auth/login', undefined, { login, password });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  return cookie!.value;
}

let admin: string;
let driverA: { id: string; cookie: string };
let driverB: { id: string; cookie: string };
let circuit: Circuit;

beforeAll(async () => {
  handle = await openDatabase({ url: process.env.TEST_DATABASE_URL });
  await ensureAdmin(handle.db, ADMIN_PASSWORD);
  app = await buildApp(handle.db, config);
  admin = await signIn('gerant', ADMIN_PASSWORD);

  const make = async (name: string, code: string) => {
    const res = await call('POST', '/api/drivers', admin, { name, code });
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    return { id, cookie: await signIn(name, code) };
  };
  driverA = await make('Chauffeur A', 'code-aaa');
  driverB = await make('Chauffeur B', 'code-bbb');

  await call('PUT', '/api/settings', admin, {
    companyName: 'Société démo',
    vatPercent: 10,
    companyAddress: 'Adresse société',
    establishments: [{ id: 'e1', label: 'Établissement', address: 'Adresse' }],
  });

  const res = await call('POST', '/api/circuits', admin, {
    name: 'Ligne démo',
    establishmentId: 'e1',
    mode: 'per_run',
    driverId: driverA.id,
    color: '#8cc4ee',
    config: {
      ...emptyCircuitConfig(),
      hours: { matin: [450, 540] },
      notes: 'Consigne démo',
      rates: { 'matin|alice': { price: 40, surcharge: 5 } },
      plan: { '1matin': { riders: ['Alice'], price: 40, surcharge: 5 } },
    },
  });
  expect(res.statusCode).toBe(200);
  circuit = res.json();
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe('authentification', () => {
  it('refuse tout accès sans session', async () => {
    for (const url of ['/api/events?from=2026-11-01&to=2026-11-30', '/api/clients', '/api/backup', '/api/drivers']) {
      expect((await call('GET', url)).statusCode).toBe(401);
    }
  });

  it('ne stocke que des empreintes, ni mot de passe ni jeton en clair', async () => {
    const [row] = await handle.db.select().from(users).where(eq(users.login, 'gerant'));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain(ADMIN_PASSWORD);
    const stored = await handle.db.select().from(sessions);
    expect(stored.some((s) => s.tokenHash === admin)).toBe(false);
  });

  it('accepte un identifiant sans accents ni casse', async () => {
    expect(
      (await call('POST', '/api/auth/login', undefined, { login: 'GÉRANT', password: ADMIN_PASSWORD })).statusCode,
    ).toBe(200);
  });

  it('verrouille le compte après 5 échecs, même avec le bon code', async () => {
    const created = await call('POST', '/api/drivers', admin, { name: 'Verrou', code: 'code-verrou' });
    const attempt = (password: string) => call('POST', '/api/auth/login', undefined, { login: 'verrou', password });
    for (let i = 0; i < 5; i++) expect((await attempt('mauvais')).statusCode).toBe(401);
    const locked = await attempt('code-verrou');
    expect(locked.statusCode).toBe(429);
    await call('DELETE', `/api/drivers/${created.json().id}`, admin);
  });

  it('expire la session du gérant après 15 minutes d’inactivité', async () => {
    const cookie = await signIn('gerant', ADMIN_PASSWORD);
    await handle.db.update(sessions).set({ lastSeenAt: new Date(Date.now() - ADMIN_IDLE_MS - 1000) });
    expect((await call('GET', '/api/auth/me', cookie)).statusCode).toBe(401);
    admin = await signIn('gerant', ADMIN_PASSWORD);
    driverA.cookie = await signIn('Chauffeur A', 'code-aaa');
    driverB.cookie = await signIn('Chauffeur B', 'code-bbb');
  });

  it('impose un mot de passe gérant long et interdit au chauffeur de reprendre celui du gérant', async () => {
    const short = await call('POST', '/api/auth/password', admin, { current: ADMIN_PASSWORD, next: 'court' });
    expect(short.statusCode).toBe(400);
    const same = await call('PATCH', `/api/drivers/${driverB.id}`, admin, { code: ADMIN_PASSWORD });
    expect(same.statusCode).toBe(400);
  });
});

describe('droits et confidentialité', () => {
  let eventA: string;

  beforeAll(async () => {
    const gen = await call('POST', '/api/circuits/generate', admin, {
      from: '2026-11-09',
      to: '2026-11-09',
      circuitIds: [circuit.id],
    });
    expect(gen.json()).toEqual({ created: 1, skipped: 0 });
    const list = await call('GET', '/api/events?from=2026-11-09&to=2026-11-09', admin);
    eventA = list.json()[0].id;
  });

  it('le gérant voit les montants', async () => {
    const [event] = (await call('GET', '/api/events?from=2026-11-09&to=2026-11-09', admin)).json() as AgendaEvent[];
    expect(event!.run!.price).toBe(40);
  });

  it('le chauffeur reçoit sa course sans aucun montant', async () => {
    const res = await call('GET', '/api/events?from=2026-11-09&to=2026-11-09', driverA.cookie);
    const [event] = res.json() as AgendaEvent[];
    expect(event!.id).toBe(eventA);
    expect(event!.run).not.toHaveProperty('price');
    expect(event!.run).not.toHaveProperty('surcharge');
    expect(res.body).not.toContain('"price"');
  });

  it('le chauffeur voit les consignes de ses circuits mais pas les tarifs', async () => {
    const res = await call('GET', '/api/circuits', driverA.cookie);
    expect(res.json()).toEqual([expect.objectContaining({ id: circuit.id, notes: 'Consigne démo' })]);
    expect(res.body).not.toContain('rates');
    expect(res.body).not.toContain('plan');
    expect((await call('GET', '/api/circuits', driverB.cookie)).json()).toEqual([]);
  });

  it('un autre chauffeur ne voit ni ne modifie la course', async () => {
    expect((await call('GET', '/api/events?from=2026-11-09&to=2026-11-09', driverB.cookie)).json()).toEqual([]);
    expect((await call('POST', `/api/events/${eventA}/status`, driverB.cookie, { status: 'annule' })).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/api/events/search?q=Ligne', driverB.cookie)).json()).toEqual([]);
  });

  it('les écrans du gérant sont interdits aux chauffeurs', async () => {
    const cookie = driverA.cookie;
    for (const [method, url] of [
      ['GET', '/api/clients'],
      ['GET', '/api/backup'],
      ['GET', '/api/billing/2026-11'],
      ['GET', '/api/billing/2026-11/memos'],
      ['GET', '/api/events/flagged'],
      ['POST', '/api/circuits/generate'],
      ['POST', '/api/backup/restore'],
      ['DELETE', `/api/drivers/${driverB.id}`],
      ['PUT', `/api/events/${eventA}`],
    ] as [Method, string][]) {
      const res = await call(method, url, cookie, method === 'GET' || method === 'DELETE' ? undefined : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('un chauffeur sans droit ne peut ni ajouter ni supprimer', async () => {
    const body = {
      driverId: driverA.id,
      date: '2026-11-10',
      start: 500,
      end: 560,
      title: 'x',
      notes: '',
      color: '#ffffff',
    };
    expect((await call('POST', '/api/events', driverA.cookie, body)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/events/${eventA}`, driverA.cookie)).statusCode).toBe(403);
  });

  it('un chauffeur autorisé n’ajoute que dans son propre agenda', async () => {
    await call('PATCH', `/api/drivers/${driverB.id}`, admin, { canAdd: true });
    const res = await call('POST', '/api/events', driverB.cookie, {
      driverId: driverA.id,
      date: '2026-11-10',
      start: 500,
      end: 560,
      title: 'Ajout',
      notes: '',
      color: '#ffffff',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.driverId).toBe(driverB.id);
  });

  it('les présences d’un chauffeur ne peuvent pas changer le montant et déclenchent la vérification', async () => {
    const res = await call('PUT', `/api/events/${eventA}/presence`, driverA.cookie, {
      riders: [
        { name: 'Alice', absent: false },
        { name: 'Remplaçant', absent: false, price: 9999 },
      ],
      price: 9999,
    });
    expect(res.statusCode).toBe(200);
    const [event] = (await call('GET', '/api/events?from=2026-11-09&to=2026-11-09', admin)).json() as AgendaEvent[];
    expect(event!.run!.price).toBe(40);
    expect(event!.run!.needsReview).toBe(true);
    expect(event!.run!.riders[1]!.price).toBeUndefined();
  });

  it('le signalement d’un chauffeur remonte au gérant et annule la facturation', async () => {
    await call('POST', `/api/events/${eventA}/status`, driverA.cookie, { status: 'absent' });
    const flagged = (await call('GET', '/api/events/flagged', admin)).json() as AgendaEvent[];
    expect(flagged.map((e) => [e.id, e.statusBy])).toEqual([[eventA, 'Chauffeur A']]);
    const [section] = (await call('GET', '/api/billing/2026-11', admin)).json();
    expect(section.rows[0].ttc).toBe(0);
    await call('POST', `/api/events/${eventA}/status`, admin, { status: null });
  });

  it('journalise les écritures sans leur contenu', async () => {
    const log = await handle.db.select().from(auditLog);
    expect(log.some((l) => l.action === 'POST /api/events/:id/status')).toBe(true);
    expect(JSON.stringify(log)).not.toContain('Alice');
  });
});

describe('événements', () => {
  const base = { start: 600, end: 660, title: 'Récurrent', notes: '', color: '#ffffff' };

  it('refuse une fin avant le début', async () => {
    const res = await call('POST', '/api/events', admin, {
      ...base,
      driverId: driverA.id,
      date: '2027-01-04',
      end: 500,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('fin');
  });

  it('crée une série, la modifie et la supprime à partir d’une date', async () => {
    const created = await call('POST', '/api/events', admin, {
      ...base,
      driverId: driverA.id,
      date: '2027-01-04',
      recurrence: { every: 1, weekdays: [1], count: 3 },
    });
    expect(created.json().created).toBe(3);
    const list = () =>
      call('GET', '/api/events?from=2027-01-01&to=2027-01-31', admin).then((r) => r.json() as AgendaEvent[]);
    const [first, second] = await list();

    await call('PUT', `/api/events/${second!.id}`, admin, {
      ...base,
      driverId: driverA.id,
      date: second!.date,
      title: 'Renommé',
      applyToFollowing: true,
    });
    expect((await list()).map((e) => e.title)).toEqual(['Récurrent', 'Renommé', 'Renommé']);

    expect((await call('GET', `/api/events/${second!.id}/following-count`, admin)).json()).toEqual({ count: 2 });
    await call('DELETE', `/api/events/${second!.id}?scope=following`, admin);
    expect((await list()).map((e) => e.id)).toEqual([first!.id]);
  });

  it('déplace une course', async () => {
    const [event] = (await call('GET', '/api/events?from=2027-01-01&to=2027-01-31', admin)).json() as AgendaEvent[];
    await call('POST', '/api/events/move', admin, {
      ids: [event!.id],
      driverId: driverB.id,
      date: '2027-01-05',
      shift: 15,
    });
    const [moved] = (await call('GET', '/api/events?from=2027-01-05&to=2027-01-05', admin)).json() as AgendaEvent[];
    expect(moved).toMatchObject({ driverId: driverB.id, start: 615, end: 675 });
  });

  it('échappe les caractères spéciaux de la recherche', async () => {
    expect((await call('GET', `/api/events/search?q=${encodeURIComponent('%%')}`, admin)).json()).toEqual([]);
  });
});

describe('circuits', () => {
  it('ne crée pas de doublons quand on relance la création', async () => {
    const body = { from: '2026-11-16', to: '2026-11-16', circuitIds: [circuit.id] };
    expect((await call('POST', '/api/circuits/generate', admin, body)).json()).toEqual({ created: 1, skipped: 0 });
    expect((await call('POST', '/api/circuits/generate', admin, body)).json()).toEqual({ created: 0, skipped: 1 });
  });

  it('exige un chauffeur avant de créer les courses', async () => {
    const res = await call('POST', '/api/circuits', admin, {
      name: 'Sans chauffeur',
      establishmentId: 'e1',
      mode: 'per_run',
      driverId: null,
      color: '#ffffff',
      config: emptyCircuitConfig(),
    });
    const gen = await call('POST', '/api/circuits/generate', admin, {
      from: '2026-11-16',
      to: '2026-11-16',
      circuitIds: [res.json().id],
    });
    expect(gen.statusCode).toBe(400);
    expect(gen.json().error).toContain('Sans chauffeur');
    await call('DELETE', `/api/circuits/${res.json().id}`, admin);
  });

  it('compte puis supprime les courses d’une période', async () => {
    const body = { from: '2026-11-16', to: '2026-11-16', circuitIds: [circuit.id] };
    expect((await call('POST', '/api/circuits/delete-runs', admin, { ...body, dryRun: true })).json()).toEqual({
      count: 1,
    });
    expect((await call('POST', '/api/circuits/delete-runs', admin, body)).json()).toEqual({ count: 1 });
  });

  it('produit le mémoire du mois', async () => {
    const [memo] = (await call('GET', '/api/billing/2026-11/memos', admin)).json();
    expect(memo).toMatchObject({ circuitName: 'Ligne démo', ttc: 45, vatPercent: 10 });
    expect(memo.amountInWords).toBe('quarante-cinq euros');
  });
});

describe('sauvegarde', () => {
  it('n’exporte aucun secret et se restaure à l’identique', async () => {
    const res = await call('GET', '/api/backup', admin);
    expect(res.body).not.toContain('scrypt');
    expect(res.body).not.toContain('passwordHash');
    const backup = res.json();

    const restored = await call('POST', '/api/backup/restore', admin, backup);
    expect(restored.statusCode).toBe(200);
    const again = (await call('GET', '/api/backup', admin)).json();
    const sortById = (list: { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(again.events)).toEqual(sortById(backup.events));
    expect(sortById(again.circuits)).toEqual(sortById(backup.circuits));
    // les codes des chauffeurs survivent à la restauration
    expect(
      (await call('POST', '/api/auth/login', undefined, { login: 'Chauffeur A', password: 'code-aaa' })).statusCode,
    ).toBe(200);
  });

  it('refuse un fichier invalide sans rien effacer', async () => {
    const before = (await call('GET', '/api/backup', admin)).json();
    expect((await call('POST', '/api/backup/restore', admin, { foo: 'bar' })).statusCode).toBe(400);
    const after = (await call('GET', '/api/backup', admin)).json();
    expect(after.events.length).toBe(before.events.length);
  });

  it('importe une sauvegarde de l’ancienne application sans reprendre ses codes', async () => {
    const res = await call('POST', '/api/backup/restore', admin, {
      name: 'Ancienne société',
      adminPin: '123456',
      agendas: [{ id: 'old', name: 'Ancien', on: true, pin: '1111' }],
      events: [
        {
          id: 'ev',
          agenda: 'old',
          date: '2026-11-09',
          start: 1,
          end: 2,
          title: 'Vieux',
          notes: '',
          color: '#fff',
          _l: 0,
          _n: 1,
        },
      ],
      clients: [],
    });
    expect(res.json()).toEqual({ drivers: 1, clients: 0, events: 1 });
    expect((await call('POST', '/api/auth/login', undefined, { login: 'Ancien', password: '1111' })).statusCode).toBe(
      401,
    );
    expect((await call('POST', '/api/auth/login', undefined, { login: 'gerant', password: '123456' })).statusCode).toBe(
      401,
    );
    expect(
      (await call('POST', '/api/auth/login', undefined, { login: 'gerant', password: ADMIN_PASSWORD })).statusCode,
    ).toBe(200);
  });
});
