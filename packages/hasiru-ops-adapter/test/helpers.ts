import { randomBytes } from 'node:crypto';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';

/** Own database per test file: ecomkit_wp_27_<suffix>. */
export async function opsDb(suffix: string, schemas: string[] = ['core', 'inventory', 'erp-sync']): Promise<TestDb> {
  process.env.INTERNAL_SECRET ??= 'h'.repeat(40);
  process.env.SETTINGS_MASTER_KEY ??= `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  return createTestDb(`wp-27-${suffix}`, { schemas });
}
