/**
 * Jeu de données entièrement fictif, pour le développement et les démonstrations.
 * Refuse de s'exécuter en production et sur une base qui contient déjà des données.
 */
import { randomUUID } from 'node:crypto';
import { addDays, emptyCircuitConfig, monday, planRuns, toIso, type AgendaEvent, type Circuit } from '@taxi-crm/domain';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { openDatabase } from '../db/client.ts';
import { circuits, clients, events, users } from '../db/schema.ts';
import { hashPassword } from '../lib/password.ts';
import { ensureAdmin } from '../auth.ts';
import { saveSettings, toEventRow } from '../mappers.ts';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Le jeu de démonstration est interdit en production.');

const { db, close } = await openDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DATA_DIR });
await ensureAdmin(db, config.ADMIN_INITIAL_PASSWORD);

const existing = await db.select({ id: users.id }).from(users).where(eq(users.role, 'driver')).limit(1);
if (existing.length) {
  console.log('La base contient déjà des chauffeurs : rien à faire.');
  await close();
  process.exit(0);
}

await saveSettings(db, {
  companyName: 'Taxi Démo',
  vatPercent: 10,
  companyAddress: 'TAXI DÉMO\n1 rue de l’Exemple\n00000 DÉMOVILLE',
  establishments: [
    { id: 'nord', label: 'Institut Nord', address: 'INSTITUT NORD\n10 avenue Fictive\n00000 DÉMOVILLE' },
    { id: 'sud', label: 'Institut Sud', address: 'INSTITUT SUD\n20 avenue Imaginaire\n00000 DÉMOVILLE' },
  ],
});

const makeDriver = async (name: string, code: string, canAdd = false, canDelete = false) => {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    name,
    login: name.toLowerCase(),
    role: 'driver',
    passwordHash: await hashPassword(code),
    canAdd,
    canDelete,
  });
  return id;
};
const alex = await makeDriver('Alex', 'demo-alex', true, true);
const sam = await makeDriver('Sam', 'demo-sam');
const lou = await makeDriver('Lou', 'demo-lou');

const clientId = randomUUID();
await db.insert(clients).values([
  { id: clientId, nom: 'EXEMPLE', prenom: 'Claude', tel: '01 00 00 00 00', address: '5 rue Fictive', notes: '' },
  { id: randomUUID(), nom: 'TEST', prenom: 'Dominique', tel: '01 00 00 00 01', address: '', notes: 'Fauteuil' },
]);

const slot = (riders: string[], price: number, surcharge = 0) => ({ riders, price, surcharge });
const lineA: Circuit = {
  id: randomUUID(),
  name: 'Ligne A',
  establishmentId: 'nord',
  mode: 'per_run',
  driverId: alex,
  color: '#8cc4ee',
  config: {
    ...emptyCircuitConfig(),
    source: 'Ligne A',
    hours: { matin: [450, 540], soir: [960, 1050] },
    notes: 'Consigne fictive : attendre devant le portail.',
    rates: {
      'matin|ana,leo': { price: 42, surcharge: 0 },
      'soir|ana,leo,mia': { price: 55, surcharge: 5 },
    },
    plan: {
      '1matin': slot(['Ana', 'Leo'], 42),
      '1soir': slot(['Ana', 'Leo', 'Mia'], 55, 5),
      '2matin': slot(['Ana', 'Leo'], 42),
      '2soir': slot(['Ana', 'Leo', 'Mia'], 55, 5),
      '4matin': slot(['Ana', 'Leo'], 42),
      '4soir': slot(['Ana', 'Mia'], 0),
    },
  },
};
const tour: Circuit = {
  id: randomUUID(),
  name: 'Circuit Nord',
  establishmentId: 'sud',
  mode: 'per_run',
  driverId: sam,
  color: '#8fd19e',
  config: {
    ...emptyCircuitConfig(),
    hours: { matin: [465, 510], soir: [990, 1035] },
    flatRate: 55,
    plan: {
      '1matin': slot(['Noa', 'Eli'], 55),
      '1soir': slot(['Noa', 'Eli'], 55),
      '3matin': slot(['Noa'], 55),
      '5soir': slot(['Noa', 'Eli'], 55),
    },
  },
};
const transport: Circuit = {
  id: randomUUID(),
  name: 'Transport individuel',
  establishmentId: 'nord',
  mode: 'per_rider',
  driverId: null,
  color: '#ffb380',
  config: {
    ...emptyCircuitConfig(),
    hours: { jour: [720, 780] },
    conventionRates: [
      { name: 'Zoé', weekday: 1, label: '', price: 32 },
      { name: 'Zoé', weekday: 3, label: '', price: 32 },
      { name: 'Tom', weekday: 1, label: 'matin', price: 18 },
    ],
    trips: [
      {
        id: randomUUID(),
        weekday: 1,
        start: 540,
        end: 570,
        driverId: lou,
        title: 'Récupérer Zoé à l’école pour dépose à l’institut',
        riders: [{ name: 'Zoé', label: '' }],
      },
      {
        id: randomUUID(),
        weekday: 1,
        start: 660,
        end: 690,
        driverId: lou,
        title: 'Retour de Zoé et Tom',
        riders: [
          { name: 'Zoé', label: '' },
          { name: 'Tom', label: 'matin' },
        ],
      },
      {
        id: randomUUID(),
        weekday: 3,
        start: 600,
        end: 630,
        driverId: alex,
        title: 'Récupérer Zoé pour dépose à l’institut',
        riders: [{ name: 'Zoé', label: '' }],
      },
    ],
  },
};

const from = toIso(monday(new Date()));
const to = toIso(addDays(monday(new Date()), 34));
const runs: Omit<AgendaEvent, 'client'>[] = [];
for (const circuit of [lineA, tour, transport]) {
  const planned = planRuns(circuit, from, to, [], randomUUID);
  runs.push(...planned.events);
  circuit.config.series = planned.series;
  await db.insert(circuits).values(circuit);
}
if (runs[0]) {
  runs[0].status = 'absent';
  runs[0].statusBy = 'Alex';
}
await db.insert(events).values(runs.map(toEventRow));

await db.insert(events).values(
  [
    { title: 'Rendez-vous clinique', driverId: sam, start: 600, end: 660, clientId },
    { title: 'Gare → domicile', driverId: lou, start: 840, end: 900, clientId: null },
  ].map((e) =>
    toEventRow({
      ...e,
      id: randomUUID(),
      date: toIso(new Date()),
      notes: 'Note fictive',
      color: '#f6c443',
      seriesId: null,
      status: null,
      statusBy: null,
      circuitId: null,
      run: null,
    }),
  ),
);

console.log(`Démonstration créée : ${runs.length} courses. Chauffeurs : alex, sam, lou.`);
await close();
