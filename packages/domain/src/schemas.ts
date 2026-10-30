import { z } from 'zod';

/** Contrats partagés entre l'API (validation) et l'interface (typage). */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');
export const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Mois invalide');
export const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Couleur invalide');
const amount = z.number().min(0).max(1_000_000);

export const periodSchema = z.enum(['matin', 'midi', 'soir', 'jour']);
export type Period = z.infer<typeof periodSchema>;

export const PERIOD_LABELS: Record<Period, string> = { matin: 'matin', midi: 'midi', soir: 'soir', jour: 'journée' };
export const PERIOD_ORDER: Record<Period, number> = { matin: 0, midi: 1, jour: 1, soir: 2 };

export const eventStatusSchema = z.enum(['annule', 'absent']);
export type EventStatus = z.infer<typeof eventStatusSchema>;
export const STATUS_LABELS: Record<EventStatus, string> = { annule: 'ANNULÉ', absent: 'ABSENT' };

export const circuitModeSchema = z.enum(['per_run', 'per_rider']);
export type CircuitMode = z.infer<typeof circuitModeSchema>;

export const riderSchema = z.object({
  name: z.string().min(1).max(200),
  label: z.string().max(100).optional(),
  price: amount.optional(),
  absent: z.boolean(),
});
export type Rider = z.infer<typeof riderSchema>;

/** Informations d'une course rattachée à un circuit. */
export const runSchema = z.object({
  period: periodSchema,
  tripId: z.string().optional(),
  riders: z.array(riderSchema),
  price: amount.optional(),
  surcharge: amount.optional(),
  needsReview: z.boolean().optional(),
});
export type Run = z.infer<typeof runSchema>;

const hoursRange = z.tuple([minutes, minutes]);

export const slotSchema = z.object({
  riders: z.array(z.string()),
  price: amount,
  surcharge: amount,
  hours: hoursRange.optional(),
});
export type Slot = z.infer<typeof slotSchema>;

export const rateSchema = z.object({ price: amount, surcharge: amount });
export type Rate = z.infer<typeof rateSchema>;

export const conventionRateSchema = z.object({
  name: z.string().min(1).max(200),
  weekday: z.number().int().min(0).max(6),
  label: z.string().max(100),
  price: amount,
});
export type ConventionRate = z.infer<typeof conventionRateSchema>;

export const tripSchema = z.object({
  id: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  start: minutes,
  end: minutes,
  driverId: z.string().nullable(),
  title: z.string().min(1).max(500),
  riders: z.array(z.object({ name: z.string().min(1), label: z.string() })),
});
export type Trip = z.infer<typeof tripSchema>;

/** Paramétrage détaillé d'un circuit, stocké en JSON. */
export const circuitConfigSchema = z.object({
  /** Nom d'origine, conservé si le circuit est renommé. */
  source: z.string().optional(),
  notes: z.string().max(5000).optional(),
  /** Forfait TTC par trajet, quel que soit le nombre de jeunes (0 € s'il n'y en a aucun). */
  flatRate: amount.optional(),
  hours: z.partialRecord(periodSchema, hoursRange),
  /** Étapes du trajet à ne pas compter comme des jeunes (« Lycée »…). */
  stops: z.array(z.string()),
  /** Tarifs déjà facturés, par `période|combinaison de jeunes`. */
  rates: z.record(z.string(), rateSchema),
  /** Planning type, par `jour de semaine + période` (`1matin`). */
  plan: z.record(z.string(), slotSchema),
  conventionRates: z.array(conventionRateSchema),
  trips: z.array(tripSchema),
  /** Identifiant de série récurrente, par période ou par trajet. */
  series: z.record(z.string(), z.string()),
});
export type CircuitConfig = z.infer<typeof circuitConfigSchema>;

export const circuitInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  establishmentId: z.string().min(1),
  mode: circuitModeSchema,
  driverId: z.string().nullable(),
  color: hexColor,
  config: circuitConfigSchema,
});
export type CircuitInput = z.infer<typeof circuitInputSchema>;
export type Circuit = CircuitInput & { id: string };

/** Ce qu'un chauffeur voit d'un circuit : ni tarifs ni conventions. */
export type CircuitSummary = Pick<Circuit, 'id' | 'name' | 'mode' | 'color'> & {
  source?: string;
  notes?: string;
  stops: string[];
};

export const eventFieldsSchema = z.object({
  driverId: z.string().min(1),
  date: isoDate,
  start: minutes,
  end: minutes,
  title: z.string().trim().min(1, 'Intitulé obligatoire').max(500),
  notes: z.string().max(5000),
  color: hexColor,
  clientId: z.string().nullable().optional(),
});
export type EventFields = z.infer<typeof eventFieldsSchema>;

export interface EventClient {
  label: string;
  tel: string;
  address: string;
}

export interface AgendaEvent extends EventFields {
  id: string;
  seriesId: string | null;
  status: EventStatus | null;
  statusBy: string | null;
  circuitId: string | null;
  run: Run | null;
  client?: EventClient | null;
}

export const recurrenceSchema = z.object({
  every: z.number().int().min(1).max(4),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Cochez au moins un jour pour la récurrence.'),
  count: z.number().int().min(1).max(400).optional(),
  until: isoDate.optional(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const createEventSchema = eventFieldsSchema.extend({ recurrence: recurrenceSchema.optional() });
export const updateEventSchema = eventFieldsSchema.extend({ applyToFollowing: z.boolean().default(false) });
export const moveEventsSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  driverId: z.string().min(1),
  date: isoDate,
  shift: z.number().int().min(-1440).max(1440),
});

export const presenceSchema = z.object({
  riders: z.array(riderSchema),
  /** Montants saisis par le gérant ; ignorés pour un chauffeur. */
  price: amount.optional(),
  surcharge: amount.optional(),
  /** Vrai si le gérant a modifié le montant à la main : il devient le tarif de cette combinaison. */
  manualPrice: z.boolean().optional(),
});
export type PresenceInput = z.infer<typeof presenceSchema>;

export const clientInputSchema = z.object({
  nom: z.string().trim().min(1, 'Nom obligatoire').max(200),
  prenom: z.string().trim().max(200),
  tel: z.string().trim().max(50),
  address: z.string().trim().max(500),
  notes: z.string().trim().max(5000),
});
export type ClientInput = z.infer<typeof clientInputSchema>;
export type Client = ClientInput & { id: string };

export const clientLabel = (c: Pick<ClientInput, 'nom' | 'prenom'>): string => `${c.nom} ${c.prenom || ''}`.trim();

export const establishmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  address: z.string().max(1000),
});
export type Establishment = z.infer<typeof establishmentSchema>;

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  vatPercent: z.number().min(0).max(100),
  companyAddress: z.string().max(1000),
  establishments: z.array(establishmentSchema),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Mot de passe du gérant : exposé sur Internet, il protège des données de mineurs. */
export const adminPasswordSchema = z.string().min(12, 'Le mot de passe doit faire au moins 12 caractères.').max(200);
/** Code d'accès d'un chauffeur. */
export const driverCodeSchema = z.string().min(6, 'Le code doit faire au moins 6 caractères.').max(200);

export const driverCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: driverCodeSchema.optional(),
});
export const driverUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  /** `null` retire le code ; absent le laisse inchangé. */
  code: driverCodeSchema.nullable().optional(),
  canAdd: z.boolean().optional(),
  canDelete: z.boolean().optional(),
});

export interface Driver {
  id: string;
  name: string;
  hasCode: boolean;
  canAdd: boolean;
  canDelete: boolean;
}

export type Role = 'admin' | 'driver';
export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  canAdd: boolean;
  canDelete: boolean;
}

export const loginSchema = z.object({
  login: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export const changePasswordSchema = z.object({
  current: z.string().min(1).max(200),
  next: adminPasswordSchema,
});

export const eventRangeSchema = z.object({ from: isoDate, to: isoDate });
export const generateRunsSchema = z.object({ from: isoDate, to: isoDate, circuitIds: z.array(z.string()).min(1) });
export const deleteRunsSchema = generateRunsSchema.extend({ dryRun: z.boolean().default(false) });

export interface BillingRow {
  circuitId: string;
  name: string;
  runCount: number;
  needsReview: { count: number; firstEventId: string | null; firstDate: string | null; firstDriverId: string | null };
  ttc: number;
  ht: number;
  vat: number;
}
export interface BillingSection {
  establishmentId: string;
  label: string;
  rows: BillingRow[];
  ttc: number;
  ht: number;
  vat: number;
}

export interface MemoRunLine {
  date: string;
  period: string;
  riderCount: number;
  riders: string;
  surcharge: number | null;
  amount: number;
}
export interface MemoRiderLine {
  name: string;
  weekday: number;
  label: string;
  dates: number[];
  unitHt: number;
  quantity: number;
  ht: number;
  ttc: number;
}
export interface Memo {
  circuitName: string;
  mode: CircuitMode;
  establishmentAddress: string;
  companyAddress: string;
  month: string;
  runLines: MemoRunLine[];
  riderLines: MemoRiderLine[];
  ttc: number;
  ht: number;
  vat: number;
  vatPercent: number;
  amountInWords: string;
}
