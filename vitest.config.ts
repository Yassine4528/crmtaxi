import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    // chaque suite d'API démarre une base PostgreSQL WASM : on laisse le temps à l'initialisation
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
