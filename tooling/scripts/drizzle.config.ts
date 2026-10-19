// Push one or more packages' schemas to a throwaway database (agents only; never production):
//   DATABASE_URL=<from pnpm db:fresh> ECOMKIT_SCHEMA=core,catalog \
//     pnpm -F @tooling/scripts exec drizzle-kit push --config drizzle.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const ids = (process.env.ECOMKIT_SCHEMA ?? 'core').split(',').map((s) => s.trim()).filter(Boolean);
const url = process.env.DATABASE_URL;
if (!url || !/\/ecomkit_[a-z0-9_]+$/.test(new URL(url).pathname)) {
  throw new Error('DATABASE_URL must point at an ecomkit_* throwaway database (pnpm db:fresh <name>)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: ids.map((id) => fileURLToPath(new URL(`../../packages/${id}/src/schema.ts`, import.meta.url))),
  dbCredentials: { url },
  strict: false,
  verbose: true,
});
