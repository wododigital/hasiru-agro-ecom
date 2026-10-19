// pnpm db:fresh <name> [--refresh-template]
// Recreates ecomkit_<name> from the template database and prints its DATABASE_URL.
import { freshDatabase } from './db';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) {
  console.error('usage: pnpm db:fresh <name> [--refresh-template]   e.g. pnpm db:fresh wp-04');
  process.exit(1);
}
const url = await freshDatabase(name, { refreshTemplate: args.includes('--refresh-template') });
console.log(`DATABASE_URL=${url}`);
