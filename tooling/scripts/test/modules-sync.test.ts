import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncModules } from '../modules-sync';

const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('modules:sync against the committed apps', () => {
  it('shop dev tree is in sync (enabled modules)', async () => {
    const r = await syncModules({ app: 'shop', config: 'dev', check: true });
    expect(r.written).toEqual([]);
    expect(r.removed).toEqual([]);
  });
  it('prod config plans no mock stubs', async () => {
    const r = await syncModules({ app: 'shop', config: 'prod', check: true });
    expect(r.planned.some((p) => p.includes('_mock'))).toBe(false);
  });
  it('minimal app is in sync', async () => {
    const r = await syncModules({ app: 'minimal', config: 'dev', check: true });
    expect(r.written).toEqual([]);
  });
  it('--list with the prod config prints the plan and writes nothing', () => {
    const registry = join(ROOT, 'apps/shop/src/generated/registry.ts');
    const before = readFileSync(registry, 'utf8');
    const out = execFileSync('pnpm', ['exec', 'tsx', 'tooling/scripts/modules-sync.ts', '--config', 'prod', '--list'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('src/generated/registry.ts');
    expect(out).not.toContain('wrote');
    expect(readFileSync(registry, 'utf8')).toBe(before);
  });
});
