import { settingsSchema } from '@taxi-crm/domain';
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../auth.ts';
import { loadSettings, saveSettings } from '../mappers.ts';
import type { RouteDeps } from './index.ts';

export function settingsRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/settings', async (req) => {
    const user = requireUser(req);
    const value = await loadSettings(db);
    // un chauffeur n'a besoin que du nom de la société
    return user.role === 'admin' ? value : { companyName: value.companyName };
  });

  app.put('/api/settings', async (req) => {
    requireAdmin(req);
    const value = settingsSchema.parse(req.body);
    await saveSettings(db, value);
    return value;
  });
}
