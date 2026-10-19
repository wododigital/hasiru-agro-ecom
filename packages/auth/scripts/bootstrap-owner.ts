// First owner for a new store: prints a one-time invite link (72 h). Refuses once any owner exists.
//   DATABASE_URL=... INTERNAL_SECRET=... SITE_URL=https://shop.example \
//     pnpm -F @ecomkit/auth exec tsx scripts/bootstrap-owner.ts owner@example.com "Owner Name"
import { closeDb } from '@ecomkit/core/db';
import { bootstrapOwner } from '../src/server/staff';

const [email, ...nameParts] = process.argv.slice(2);
if (!email || !nameParts.length) {
  console.error('usage: bootstrap-owner.ts <email> <name>');
  process.exit(1);
}
try {
  const { link } = await bootstrapOwner({ email, name: nameParts.join(' ') });
  console.info(`Owner created. Open this link to set the password (valid 72 h):\n${link}`);
} finally {
  await closeDb();
}
