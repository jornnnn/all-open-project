import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Los tests se ejecutan dentro del runtime de Workers, con un D1 local de verdad (SQLite).
export default defineConfig(async () => {
  const migraciones = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migraciones, INGEST_KEY: 'clave-de-prueba' },
        },
      }),
    ],
    test: { setupFiles: ['./test/aplicar-migraciones.ts'] },
  };
});
