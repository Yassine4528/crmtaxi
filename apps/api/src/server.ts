import { buildApp } from './app.ts';
import { ensureAdmin } from './auth.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/client.ts';

// toutes les dates métier (« aujourd'hui », jours fériés) sont à l'heure française
process.env.TZ ??= 'Europe/Paris';

const config = loadConfig();
const { db, close } = await openDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DATA_DIR });
const hasAdmin = await ensureAdmin(db, config.ADMIN_INITIAL_PASSWORD);
const app = await buildApp(db, config);

if (!hasAdmin) {
  const message = 'Aucun compte gérant : définissez ADMIN_INITIAL_PASSWORD (12 caractères minimum) puis redémarrez.';
  if (config.NODE_ENV === 'production') throw new Error(message);
  app.log.warn(message);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(close)
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
