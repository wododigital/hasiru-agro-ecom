// pnpm jobs:install
// Installs or upgrades the pg-boss schema. The production web process runs with migrate=false, so a
// migrated database without this step answers every enqueue (enquiry, notify-me, checkout) with "pg-boss is not installed".
import { installJobSchema } from '../../packages/core/src/jobs/boss';

const url = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('usage: DATABASE_URL=postgres://... pnpm jobs:install   (DATABASE_OWNER_URL preferred)');
  process.exit(1);
}
await installJobSchema(url);
console.log('pg-boss schema installed');
