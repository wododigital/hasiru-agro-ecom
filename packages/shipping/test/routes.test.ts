import type { ShippingMethodQuote } from '@ecomkit/core/contracts';
import type { TestDb } from '@ecomkit/core/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../src/routes/delivery-check';
import { configureShipping } from '../src/server';
import { seedFixture, shippingDb } from './helpers';

let t: TestDb;
let ip = 0;
const get = (query: string, addr = `10.0.0.${++ip}`) => GET(new Request(`http://localhost/api/delivery-check?${query}`, { headers: { 'x-real-ip': addr } }));
const outstation = (methods: ShippingMethodQuote[]) => methods.find((m) => m.kind === 'outstation');

beforeAll(async () => {
  t = await shippingDb('routes');
  await seedFixture();
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(() => configureShipping({}));

describe('GET /api/delivery-check', () => {
  it('quotes by district and weight', async () => {
    const res = await get('district=mysuru&state=KA&kg=2000');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { districtSlug: string; methods: ShippingMethodQuote[] };
    expect(body.districtSlug).toBe('mysuru');
    expect(outstation(body.methods)).toMatchObject({ available: true, pricePaise: 525_000, distanceKm: 150 });
  });

  it('resolves a pincode through the bound directory; without one it asks for a district', async () => {
    expect((await get('pincode=570001')).status).toBe(422);
    configureShipping({ resolvePincode: async (pin) => (pin === '570001' ? { districtSlug: 'mysuru', stateCode: 'KA' } : null) });
    const ok = await get('pincode=570001&kg=500');
    expect(ok.status).toBe(200);
    expect(outstation(((await ok.json()) as { methods: ShippingMethodQuote[] }).methods)?.pricePaise).toBe(330_000);
    expect((await get('pincode=110001')).status).toBe(404);
  });

  it('rejects bad input', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('pincode=012345')).status).toBe(400);
    expect((await get('district=Not%20A%20Slug!')).status).toBe(400);
    expect((await get('district=mysuru&kg=-1')).status).toBe(400);
  });

  it('rate limits per visitor (default 30 a minute)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await get('district=mysuru&state=KA', '10.9.9.9')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
