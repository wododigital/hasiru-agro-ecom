// Migrations for this app: the union of enabled modules' schemas (src/generated/schema.ts, written by modules:sync).
// `drizzle-kit generate` is run by the orchestrator only; agents push to throwaway databases (docs/CONVENTIONS.md).
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env: DATABASE_URL must come from the environment
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/generated/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
