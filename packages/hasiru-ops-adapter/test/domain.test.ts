import { describe, expect, it } from 'vitest';
import { daysUntil, grantScript, opsSettingsSchema, pgRowToItem, signingString, toIntakeBody } from '../src/domain';
import { signRequest, verifyRequest } from '../src/server';

describe('grant script', () => {
  it('creates a login role with column-level SELECT only, read-only by default', () => {
    const s = grantScript();
    expect(s).toContain('create role ecom_sync login');
    expect(s).toContain('alter role ecom_sync set default_transaction_read_only = on;');
    expect(s).toContain('grant select (id, name, variety, size_grade, cost_rate, is_active, track_stock) on public.items to ecom_sync;');
    expect(s).toContain('grant select (item_id, qty_available, status, expected_ready) on public.stock_batches to ecom_sync;');
    expect(s).toContain('create policy ecom_sync_read on public.items for select to ecom_sync using (true);');
    expect(s).not.toMatch(/insert|update|delete|all privileges|bypassrls/i);
    expect(() => grantScript('x; drop table items')).toThrow();
  });
});

describe('row mapping', () => {
  const now = new Date('2026-10-20T03:00:00Z'); // 08:30 IST
  it('sums ready stock, joins variety and size grade, converts rupees to paise', () => {
    expect(pgRowToItem({ id: 'a', name: 'Mango', variety: 'Alphonso', size_grade: '3 ft', cost_rate: '45.50', available: '12.00', expected_ready: null }, now)).toEqual({
      erpItemId: 'a',
      sku: null,
      name: 'Mango',
      variety: 'Alphonso 3 ft',
      available: 12,
      readyInDays: null,
      costPaise: 4550,
      updatedAt: now.toISOString(),
    });
  });
  it('gives ready-in days only when nothing is ready', () => {
    expect(pgRowToItem({ id: 'b', name: 'Teak', variety: null, size_grade: null, cost_rate: null, available: '0', expected_ready: '2026-11-19' }, now)).toMatchObject({ available: 0, readyInDays: 30, costPaise: null, variety: null });
    expect(daysUntil('2026-10-01', '2026-10-20')).toBe(0);
  });
});

describe('signing', () => {
  it('signs timestamp, nonce, method, path and body', () => {
    expect(signingString({ timestamp: '1', nonce: 'n', method: 'post', path: '/p?q=1', body: '{}' })).toBe('1\nn\nPOST\n/p?q=1\n{}');
    const h = new Headers(signRequest({ method: 'POST', path: '/x', body: 'b', secret: 's' }));
    expect(verifyRequest({ method: 'POST', path: '/x', body: 'b', headers: h, secret: 's' })).toMatchObject({ ok: true });
    expect(verifyRequest({ method: 'POST', path: '/y', body: 'b', headers: h, secret: 's' })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyRequest({ method: 'POST', path: '/x', body: 'b', headers: h, secret: 's', now: new Date(Date.now() + 301_000) })).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('lead intake body', () => {
  it('maps the lead to the existing intake fields', () => {
    expect(
      toIntakeBody({ leadId: 'L1', source: 'notify_me', name: 'A', phone: '+919800000001', email: 'a@example.com', district: null, landAcres: null, purpose: null, notes: 'Wants mango', createdAt: '2026-10-20T00:00:00Z' }),
    ).toEqual({ name: 'A', phone: '+919800000001', email: 'a@example.com', message: 'Wants mango. Store lead L1', source: 'ecom-notify-me', lead_type: 'nursery' });
  });
});

describe('settings', () => {
  it('defaults to mock and accepts only https endpoints', () => {
    expect(opsSettingsSchema.parse({}).transport).toBe('mock');
    expect(opsSettingsSchema.safeParse({ opsBaseUrl: 'http://ops.example.com' }).success).toBe(false);
    expect(opsSettingsSchema.safeParse({ opsBaseUrl: 'https://ops.example.com' }).success).toBe(true);
  });
});
