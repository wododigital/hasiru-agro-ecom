// The assistant against real Postgres: the real catalog (seeded through its importer), the real model SDK talking
// to the mock provider handler, the real route handler, transcripts, cache and rate limits.
import { randomBytes } from 'node:crypto';
import { configureCatalog, importSeed } from '@ecomkit/catalog/server';
import { catalogProduct, catalogRelated, catalogVariant } from '@ecomkit/catalog/schema';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import { coreIntegrationLog } from '@ecomkit/core/schema';
import { setSettings } from '@ecomkit/core/settings';
import { createTestDb, type TestDb } from '@ecomkit/core/testing';
import { fakeFit, fakeInventory } from '@ecomkit/core/testing/fakes';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '../src/domain';
import { POST as mockProvider, resetAssistantMock } from '../src/mocks/claude';
import { aiConversation, aiMessage, aiNarrationCache } from '../src/schema';
import {
  answer,
  assistantSettings,
  buildFacts,
  configureAssistant,
  getConversation,
  handleAssistantPost,
  historyFor,
  listConversations,
  narrate,
  pruneTranscripts,
  testConnectionAction,
  type AssistantSettings,
} from '../src/server';
import { TranscriptPage, TranscriptsPage } from '../src/admin';
import { createElement } from 'react';
import { AssistantDrawer } from '../src/ui';
import { loadAssistantCards } from '../src/ui/cards-action';
import { fakeRegistry, MANAGER, pricingFor, renderHtml, signInAs, writeSeedDir } from './fixtures';

let t: TestDb;
const ids: Record<string, string> = {};
const variants: Record<string, string> = {};
let mockCalls = 0;

/** Routes the SDK's HTTP calls to the mock provider route handler (no network). */
const transport: typeof fetch = async (input, init) => {
  mockCalls += 1;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return mockProvider(new Request(url, init));
};

const DEFAULTS = assistantSettings.schema.parse({});
const settings = (o: Partial<AssistantSettings> = {}): AssistantSettings => ({ ...DEFAULTS, ...o });

function bind(o: { companions?: boolean } = {}) {
  const variantSlug = new Map(Object.entries(variants).map(([slug, v]) => [v, slug]));
  const registry = fakeRegistry({
    modules: ['catalog', 'pricing', 'inventory', 'places', 'cart'],
    services: { pricing: pricingFor(variantSlug), inventory: fakeInventory({ [variants['beta-guava']!]: 'preorder', [variants['gamma-coffee']!]: 'out_of_stock' }), places: fakeFit() },
  });
  configureCatalog({ registry, readDistrict: async () => null });
  configureAssistant({ registry, transport, readDistrict: async () => null, ...(o.companions === false ? { companions: async () => ({}) } : {}) });
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handleAssistantPost(
    new Request('http://shop.test/api/assistant/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-real-ip': '203.0.113.7', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

async function events(res: Response): Promise<StreamEvent[]> {
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as StreamEvent);
}

beforeAll(async () => {
  process.env.INTERNAL_SECRET = 'q'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  // CREATE DATABASE from the template plus three schema pushes: slow under the full parallel workspace run.
  t = await createTestDb('wp-26-assistant', { schemas: ['core', 'catalog', 'ai-assistant'] });
  const report = await importSeed({ seedDir: await writeSeedDir() });
  expect(report.inserted).toBeGreaterThan(0);
  const rows = await t.db.select({ id: catalogProduct.id, slug: catalogProduct.slug, variantId: catalogVariant.id }).from(catalogProduct).innerJoin(catalogVariant, eq(catalogVariant.productId, catalogProduct.id));
  for (const r of rows) {
    ids[r.slug] = r.id;
    variants[r.slug] = r.variantId;
  }
  // An admin-curated companion relation (catalog_related) for the default companion source.
  await t.db.insert(catalogRelated).values({ productId: ids['alpha-mango']!, relatedId: ids['delta-gliricidia']!, relation: 'companion' });
}, 180_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  bind();
  resetAssistantMock();
  mockCalls = 0;
  setAuthProvider(async () => null);
  await t.db.delete(aiNarrationCache);
  await setSettings(assistantSettings, { provider: 'mock', mockBehaviour: 'normal', perConversationPerHour: 20, perIpPerDay: 100, monthlyTokenCap: 0, enabled: true }, { actorId: null, actorType: 'system' });
});

describe('rules engine over the real catalogue', () => {
  it('answers a named product with live price, bulk tier and stock', async () => {
    const f = await buildFacts('Do you have mango?', 'shop');
    expect(f.products.map((p) => p.id)).toEqual([ids['alpha-mango']]);
    expect(f.products[0]).toMatchObject({ unitPaise: 45_000, bulk: { minQty: 50, unitPaise: 35_500 }, stock: 'in_stock', bearingYears: { min: 3, max: 4 } });
  });

  it('filters by price cap, shade, nitrogen, bearing and stock; out of stock items sink', async () => {
    const cheap = await buildFacts('What can I get under Rs 100?', 'shop');
    // Teak counts through its bulk tier (Rs 90); out of stock coffee (Rs 60) stays but sorts last.
    expect(cheap.products.map((p) => p.name)).toEqual(['Delta Gliricidia', 'Teak', 'Gamma Coffee']);
    const shade = await buildFacts('What grows in partial shade?', 'shop');
    expect(shade.products.map((p) => p.name)).toEqual(['Beta Guava', 'Gamma Coffee']);
    expect(shade.products[1]!.stock).toBe('out_of_stock');
    const inStock = await buildFacts('Which items are in stock?', 'shop');
    expect(inStock.products.map((p) => p.name)).not.toContain('Gamma Coffee');
    expect((await buildFacts('which ones fix nitrogen', 'shop')).products.map((p) => p.name)).toEqual(['Delta Gliricidia']);
    expect((await buildFacts('fruit within 2 years', 'shop')).products.map((p) => p.name)).toEqual(['Beta Guava']);
  });

  it('policy questions carry notes, unknown names say no match, off-topic is declined', async () => {
    const bulk = await buildFacts('How does bulk pricing work?', 'shop');
    expect(bulk.products).toEqual([]);
    expect(bulk.notes).toEqual(['bulk']);
    expect((await buildFacts('Do you sell dragonfruit?', 'shop')).notes).toEqual(['noMatch']);
    expect((await buildFacts('tell me a joke', 'shop')).notes).toEqual(['offTopic']);
  });

  it('sizes an area order from catalog spacing and finds companions from catalog relations', async () => {
    const area = await buildFacts('How many mango for 2 acres?', 'shop');
    expect(area.products[0]!.areaQty).toEqual({ qty: 269, acres: 2, spacing: '18 x 18' });
    expect(area.notes).toContain('acreage');
    const comp = await buildFacts('What grows well with mango?', 'shop');
    expect(comp.companionOf).toEqual({ id: ids['alpha-mango'], name: 'Alpha Mango' });
    expect(comp.products.map((p) => p.name)).toEqual(['Delta Gliricidia']);
    bind({ companions: false });
    expect((await buildFacts('What grows well with mango?', 'shop')).notes).toContain('companionsUnavailable');
  });

  it('district fit from places: question place wins, poor fits drop out', async () => {
    const f = await buildFacts('What grows in Mysuru?', 'plan');
    expect(f.district).toEqual({ slug: 'mysuru', name: 'Mysuru' });
    expect(f.products.length).toBeGreaterThan(0);
    expect(f.products.every((p) => p.fit === 'ok')).toBe(true);
    expect((await buildFacts('What grows in Ballari?', 'plan')).products).toEqual([]);
  });
});

describe('narration: model, cache, validator and fallbacks', () => {
  it('model answer through the SDK + mock, ids resolved, then served from the narration cache', async () => {
    const f = await buildFacts('Which mango is in stock?', 'shop');
    const first = await narrate(f, { settings: settings() });
    expect(first).toMatchObject({ source: 'model', model: 'claude-haiku-5-5', fallbackReason: null });
    expect(first.answer).toContain(`[[${ids['alpha-mango']}]]`);
    expect(first.answer).toContain('Rs 450 each');
    expect(first.productIds).toEqual([ids['alpha-mango']]);
    expect(first.tokensIn).toBeGreaterThan(0);
    const second = await narrate(f, { settings: settings() });
    expect(second.source).toBe('cache');
    expect(second.answer).toBe(first.answer);
    expect(mockCalls).toBe(1);
  });

  it('falls back to the template on refusal, provider error, broken output, and logs the integration call', async () => {
    const f = await buildFacts('Which mango is in stock?', 'shop');
    for (const [behaviour, reason] of [
      ['refusal', 'refusal'],
      ['error', 'error'],
      ['invalid', 'invalid_output'],
    ] as const) {
      const r = await narrate(f, { settings: settings({ mockBehaviour: behaviour }) });
      expect(r.source, behaviour).toBe('template');
      expect(r.fallbackReason, behaviour).toBe(reason);
      expect(r.answer).toContain(`[[${ids['alpha-mango']}]]`);
      expect(r.answer).not.toMatch(/[\u2014\u2013]/);
    }
    const failed = await t.db.select().from(coreIntegrationLog).where(and(eq(coreIntegrationLog.provider, 'assistant-model'), eq(coreIntegrationLog.status, 'failed')));
    expect(failed.length).toBeGreaterThanOrEqual(1);
  });

  it('the validator strips an invented product and invented prices from a model answer', async () => {
    const f = await buildFacts('Which mango is in stock?', 'shop');
    const r = await narrate(f, { settings: settings({ mockBehaviour: 'hallucinate' }) });
    expect(r.source).toBe('model');
    expect(r.droppedRefs).toContain('p99');
    expect(r.droppedSentences.join(' ')).toContain('9,999 saplings');
    expect(r.answer).not.toContain('Rs 1 ');
    expect(r.answer).not.toContain('Rs 7');
    expect(r.productIds).toEqual([ids['alpha-mango']]);
  });

  it('template mode, live without a key, mocks off and the token cap never call the provider', async () => {
    const f = await buildFacts('Which mango is in stock?', 'shop');
    expect((await narrate(f, { settings: settings({ provider: 'template' }) })).fallbackReason).toBe('template_mode');
    expect((await narrate(f, { settings: settings({ provider: 'live', apiKey: undefined }) })).fallbackReason).toBe('not_configured');
    process.env.ENABLE_MOCKS = '0';
    expect((await narrate(f, { settings: settings() })).fallbackReason).toBe('mocks_disabled');
    process.env.ENABLE_MOCKS = '1';
    await answer('Which mango is in stock?', { settings: settings() }); // spends some tokens
    expect((await narrate(f, { settings: settings({ monthlyTokenCap: 1 }) })).fallbackReason).toBe('token_cap');
    expect(mockCalls).toBe(1);
  });

  it('settings test-connection action reports the provider result', async () => {
    expect(await testConnectionAction()).toMatchObject({ ok: true, message: expect.stringContaining('claude-haiku-5-5') });
    await setSettings(assistantSettings, { mockBehaviour: 'refusal' }, { actorId: null, actorType: 'system' });
    await t.db.delete(aiNarrationCache);
    expect(await testConnectionAction()).toMatchObject({ ok: false, message: expect.stringContaining('declined') });
  });
});

describe('POST /api/assistant/stream', () => {
  it('streams meta, deltas and done, then logs both turns with the facts', async () => {
    const res = await post({ question: 'Which mango is in stock?', mode: 'shop' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const ev = await events(res);
    expect(ev[0]).toMatchObject({ type: 'meta', products: [{ id: ids['alpha-mango'], name: 'Alpha Mango', purchasable: true }] });
    const text = ev.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');
    expect(text).toContain(`[[${ids['alpha-mango']}]]`);
    expect(ev.at(-1)).toMatchObject({ type: 'done', source: 'model', productIds: [ids['alpha-mango']] });
    const conversationId = (ev[0] as { conversationId: string }).conversationId;
    const msgs = await t.db.select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId));
    expect(msgs.map((m) => m.role).sort()).toEqual(['assistant', 'user']);
    const reply = msgs.find((m) => m.role === 'assistant')!;
    expect(reply).toMatchObject({ source: 'model', model: 'claude-haiku-5-5', content: text });
    expect((reply.facts as { products: { name: string }[] }).products[0]!.name).toBe('Alpha Mango');

    // A follow-up in the same conversation sees the earlier turns as plain text.
    await events(await post({ question: 'And guava?', conversationId }));
    const history = await historyFor(conversationId);
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(history[1]!.text).toContain('Alpha Mango');
    expect(history[1]!.text).not.toContain('[[');
  });

  it('refuses cross-site posts, bad bodies, and answers "disabled" when switched off', async () => {
    expect((await post({ question: 'hi' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post('not json')).status).toBe(400);
    expect((await post({ question: 'x'.repeat(401) })).status).toBe(400);
    expect((await post({ question: 'hi', mode: 'admin' })).status).toBe(400);
    expect((await post({ question: 'y'.repeat(5000) })).status).toBe(413);
    await setSettings(assistantSettings, { enabled: false }, { actorId: null, actorType: 'system' });
    const off = await post({ question: 'hi' });
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: 'disabled' });
  });

  it('rate limits per conversation per hour and per network address per day', async () => {
    await setSettings(assistantSettings, { perConversationPerHour: 2 }, { actorId: null, actorType: 'system' });
    const ip = { 'x-real-ip': '198.51.100.20' };
    const first = await events(await post({ question: 'mango?' }, ip));
    const conversationId = (first[0] as { conversationId: string }).conversationId;
    expect((await post({ question: 'guava?', conversationId }, ip)).status).toBe(200);
    const limited = await post({ question: 'teak?', conversationId }, ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });

    await setSettings(assistantSettings, { perIpPerDay: 2, perConversationPerHour: 20 }, { actorId: null, actorType: 'system' });
    const other = { 'x-real-ip': '198.51.100.21' };
    expect((await post({ question: 'a?' }, other)).status).toBe(200);
    expect((await post({ question: 'b?' }, other)).status).toBe(200);
    expect((await post({ question: 'c?' }, other)).status).toBe(429);
    expect((await post({ question: 'd?' }, { 'x-real-ip': '198.51.100.22' })).status).toBe(200);
  });
});

describe('transcripts admin, cards and retention', () => {
  it('transcripts are staff-only (customers.read) and render the conversation with its fallback details', async () => {
    const { conversationId } = await answer('Which mango is in stock?', { settings: settings({ mockBehaviour: 'hallucinate' }) });
    await expect(listConversations()).rejects.toThrow();
    expect(await renderHtml(await TranscriptsPage({ searchParams: {} }))).toContain('do not have access');
    signInAs(MANAGER);
    const list = await listConversations({ q: 'mango' });
    expect(list.rows.some((r) => r.id === conversationId)).toBe(true);
    expect((await getConversation(conversationId))!.messages).toHaveLength(2);
    const html = await renderHtml(await TranscriptPage({ id: conversationId }));
    expect(html).toContain('Alpha Mango');
    expect(html.replace(/<!-- -->/g, '')).toContain('Validator removed 1 unknown product reference(s) and 2 sentence(s)');
    // (The list page's DataTable toolbar needs the Next app router, so the staff list is checked through listConversations.)
  });

  it('the header trigger renders static markup with copy from messages (drawer code loads on intent)', async () => {
    const html = await renderHtml(createElement(AssistantDrawer));
    expect(html).toContain('data-cta="assistant-open"');
    expect(html).toContain('aria-label="Open the shopping assistant"');
    expect(html).not.toContain('Checking the catalogue');
  });

  it('card rail renders the catalog product card for answer ids and ignores junk', async () => {
    const html = await renderHtml(await loadAssistantCards([ids['alpha-mango'], ids['teak']]));
    expect(html).toContain('Alpha Mango');
    expect(html).toContain('Teak');
    expect(await loadAssistantCards(['not-a-uuid'])).toBeNull();
    expect(await loadAssistantCards('x')).toBeNull();
  });

  it('prunes transcripts past retention and cascades their messages', async () => {
    const { conversationId } = await answer('mango?', { settings: settings() });
    await t.db.update(aiConversation).set({ lastAt: new Date('2025-01-01T00:00:00Z') }).where(eq(aiConversation.id, conversationId));
    const r = await pruneTranscripts(90);
    expect(r.conversations).toBeGreaterThanOrEqual(1);
    expect(await t.db.select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId))).toEqual([]);
  });
});
