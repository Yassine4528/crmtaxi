import type { CircuitConfig, CircuitMode, Establishment, EventStatus, Role, Run } from '@taxi-crm/domain';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Comptes : le gérant et les chauffeurs (un chauffeur = un agenda). */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Identifiant de connexion normalisé (sans casse ni accents). */
  login: text('login').notNull().unique(),
  role: text('role').$type<Role>().notNull(),
  passwordHash: text('password_hash'),
  canAdd: boolean('can_add').notNull().default(false),
  canDelete: boolean('can_delete').notNull().default(false),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** Empreinte SHA-256 du jeton : une fuite de la base ne donne accès à aucune session. */
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Paramètres de la société (ligne unique). */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  companyName: text('company_name').notNull(),
  vatPercent: doublePrecision('vat_percent').notNull(),
  companyAddress: text('company_address').notNull(),
  establishments: jsonb('establishments').$type<Establishment[]>().notNull(),
});

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  nom: text('nom').notNull(),
  prenom: text('prenom').notNull(),
  tel: text('tel').notNull(),
  address: text('address').notNull(),
  notes: text('notes').notNull(),
  createdAt: createdAt(),
});

export const circuits = pgTable('circuits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  establishmentId: text('establishment_id').notNull(),
  mode: text('mode').$type<CircuitMode>().notNull(),
  driverId: text('driver_id').references(() => users.id, { onDelete: 'set null' }),
  color: text('color').notNull(),
  config: jsonb('config').$type<CircuitConfig>().notNull(),
  createdAt: createdAt(),
});

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    driverId: text('driver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    startMin: integer('start_min').notNull(),
    endMin: integer('end_min').notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull(),
    color: text('color').notNull(),
    seriesId: text('series_id'),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    status: text('status').$type<EventStatus>(),
    statusBy: text('status_by'),
    circuitId: text('circuit_id').references(() => circuits.id, { onDelete: 'cascade' }),
    run: jsonb('run').$type<Run>(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_date_idx').on(t.date),
    index('events_driver_date_idx').on(t.driverId, t.date),
    index('events_series_idx').on(t.seriesId),
    index('events_circuit_date_idx').on(t.circuitId, t.date),
    index('events_client_idx').on(t.clientId),
    index('events_status_idx').on(t.status),
  ],
);

/** Journal des écritures : qui a fait quoi et quand, sans aucune donnée personnelle du contenu. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: text('user_id'),
    action: text('action').notNull(),
    entityId: text('entity_id'),
    statusCode: integer('status_code').notNull(),
  },
  (t) => [index('audit_at_idx').on(t.at)],
);
