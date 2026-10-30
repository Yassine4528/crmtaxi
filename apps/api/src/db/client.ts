import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** PostgreSQL en production ; PGlite (PostgreSQL embarqué) en développement et en test, sans rien à installer. */
export async function openDatabase(options: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (options.url) {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: options.url, max: 10 });
    // une connexion inactive coupée par le serveur ne doit pas faire tomber le processus
    pool.on('error', (err) => console.error('Connexion PostgreSQL perdue :', err.message));
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (options.pgliteDir) mkdirSync(options.pgliteDir, { recursive: true });
  const client = new PGlite(options.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
