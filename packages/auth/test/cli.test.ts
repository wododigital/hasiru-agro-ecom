import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authUser } from '../src/schema';

const run = promisify(execFile);
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const script = fileURLToPath(new URL('../scripts/bootstrap-owner.ts', import.meta.url));
let t: TestDb;

beforeAll(async () => {
  t = await createTestDb('wp-02-cli', { schemas: ['core', 'auth'] });
});

afterAll(async () => {
  await t?.close();
});

describe('scripts/bootstrap-owner.ts', () => {
  // Production: no notifications module, so the link must come from stdout.
  const env = () => ({ ...process.env, DATABASE_URL: t.url, INTERNAL_SECRET: 'c'.repeat(48), SITE_URL: 'https://shop.example', NODE_ENV: 'production' as const });

  it('creates the first owner and prints an invite link, then refuses a second run', async () => {
    const { stdout } = await run(tsx, [script, 'first@example.com', 'First', 'Owner'], { env: env() });
    expect(stdout).toMatch(/https:\/\/shop\.example\/admin\/login\?invite=[\w-]{40,}/);
    const [owner] = await t.db.select().from(authUser).where(eq(authUser.email, 'first@example.com'));
    expect(owner).toMatchObject({ role: 'owner', name: 'First Owner' });
    await expect(run(tsx, [script, 'second@example.com', 'Second'], { env: env() })).rejects.toMatchObject({ stderr: expect.stringMatching(/owner already exists/) });
    expect(await t.db.select().from(authUser).where(eq(authUser.email, 'second@example.com'))).toHaveLength(0);
  });
});
