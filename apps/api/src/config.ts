import { adminPasswordSchema } from '@taxi-crm/domain';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  /** Obligatoire en production. En développement, une base PGlite locale est utilisée à défaut. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default('.data/pglite'),
  /** Crée le compte gérant au premier démarrage, si aucun n'existe. */
  ADMIN_INITIAL_PASSWORD: adminPasswordSchema.optional(),
  WEB_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
    throw new Error('DATABASE_URL est obligatoire en production.');
  }
  return config;
}
