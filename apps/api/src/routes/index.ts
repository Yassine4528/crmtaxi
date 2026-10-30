import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import { authRoutes } from './auth.ts';
import { backupRoutes } from './backup.ts';
import { billingRoutes } from './billing.ts';
import { circuitRoutes } from './circuits.ts';
import { clientRoutes } from './clients.ts';
import { driverRoutes } from './drivers.ts';
import { eventRoutes } from './events.ts';
import { settingsRoutes } from './settings.ts';

export interface RouteDeps {
  db: Db;
  secureCookies: boolean;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  for (const routes of [
    authRoutes,
    settingsRoutes,
    driverRoutes,
    eventRoutes,
    clientRoutes,
    circuitRoutes,
    billingRoutes,
    backupRoutes,
  ]) {
    routes(app, deps);
  }
}
