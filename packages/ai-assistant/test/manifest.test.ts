import { fileURLToPath } from 'node:url';
import { createRegistry, resolveModules } from '@ecomkit/core/manifest';
import core from '@ecomkit/core/manifest';
import catalog from '@ecomkit/catalog/manifest';
import { describe, expect, it } from 'vitest';
import manifest from '../src/manifest';
import { assistantSettingsSchema } from '../src/settings';

describe('ai-assistant manifest', () => {
  it('resolves with only core and catalog enabled (pricing, inventory, places, planting, cart stay optional)', () => {
    const media = { id: 'media', dependsOn: ['core'] as const };
    const ordered = resolveModules([core, media, catalog, manifest], ['core', 'media', 'catalog', 'ai-assistant']);
    expect(ordered.at(-1)!.id).toBe('ai-assistant');
    expect(manifest.dependsOn).toEqual(['core', 'catalog']);
    const registry = createRegistry([core, media, catalog, manifest], { mocks: true });
    expect(registry.has('ai-assistant')).toBe(true);
  });

  it('every route, mock and admin page module exports what its stub re-exports', async () => {
    const all = [...(manifest.routes ?? []), ...(manifest.mockRoutes ?? []), ...(manifest.admin?.pages ?? [])];
    expect(all.map((r) => r.path)).toEqual(['/api/assistant/stream', '/api/_mock/claude/[...path]', '/admin/assistant', '/admin/assistant/[id]']);
    for (const r of all) {
      const ext = r.module.startsWith('mocks/') ? 'ts' : 'tsx';
      const mod = (await import(/* @vite-ignore */ fileURLToPath(new URL(`../src/${r.module}.${ext}`, import.meta.url)))) as Record<string, unknown>;
      for (const name of r.exports) expect(typeof mod[name], `${r.module} ${name}`).toBe('function');
    }
    for (const m of manifest.mockRoutes ?? []) expect(m.path.startsWith('/api/_mock/')).toBe(true);
  });

  it('settings default to the mock provider on Haiku at low effort with the plan limits, and expose a test action', async () => {
    expect(assistantSettingsSchema.parse({})).toMatchObject({ enabled: true, provider: 'mock', model: 'claude-haiku-5-5', effort: 'low', perConversationPerHour: 20, perIpPerDay: 100, transcriptDays: 90 });
    expect(manifest.settings?.actions?.map((a) => [a.id, a.kind])).toEqual([['test-connection', 'test-connection']]);
    expect(typeof (await manifest.settings!.actions![0]!.run())).toBe('function');
    expect(Object.keys(await manifest.schema!())).toEqual(expect.arrayContaining(['aiConversation', 'aiMessage', 'aiNarrationCache']));
    expect(Object.keys(manifest.jobs ?? {})).toEqual(['ai-assistant.prune']);
    expect(manifest.schedules?.[0]?.job).toBe('ai-assistant.prune');
  });

  it('mock provider answers 404 unless mocks are enabled', async () => {
    const { POST } = await import('../src/mocks/claude');
    const prev = process.env.ENABLE_MOCKS;
    process.env.ENABLE_MOCKS = '0';
    expect((await POST(new Request('http://x/api/_mock/claude/v1/messages', { method: 'POST', body: '{}' }))).status).toBe(404);
    process.env.ENABLE_MOCKS = prev;
  });
});
