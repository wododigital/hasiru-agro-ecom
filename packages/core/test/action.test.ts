import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ForbiddenError, getViewer, setAuthProvider } from '../src/auth-context';
import type { AuthContext, StaffViewer } from '../src/contracts';
import { zodAction } from '../src/validation';

const staff: StaffViewer = { kind: 'staff', userId: 'u1', name: 'A', email: 'a@x.in', role: 'catalog_editor', permissions: ['products.write'] };
const auth: AuthContext = {
  getViewer: async () => staff,
  requirePermission: async (p) => {
    if (!staff.permissions.includes(p)) throw new ForbiddenError();
    return staff;
  },
  requireOwner: async () => {
    throw new Error('not used');
  },
};

describe('zodAction + auth-context', () => {
  const rename = zodAction(z.object({ name: z.string().min(2), tags: z.array(z.string()).default([]) }), async (input) => input, { permission: 'products.write' });

  it('fails closed with no auth provider, then parses FormData once one is bound', async () => {
    expect(await rename({ name: 'Neem', tags: [] })).toEqual({ ok: false, fieldErrors: {}, formError: 'forbidden' });
    expect(await getViewer()).toEqual({ kind: 'guest' });

    setAuthProvider(async () => auth);
    const fd = new FormData();
    fd.set('name', 'Neem');
    fd.append('tags', 'a');
    fd.append('tags', 'b');
    fd.set('$ACTION_ID_x', '');
    expect(await rename(fd)).toEqual({ ok: true, data: { name: 'Neem', tags: ['a', 'b'] } });
    expect(await rename({ name: 'Neem', tags: ['a', 'b'] })).toEqual({ ok: true, data: { name: 'Neem', tags: ['a', 'b'] } });
    expect(await rename({ name: 'N' })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
  });

  it('returns forbidden for a missing permission', async () => {
    setAuthProvider(async () => auth);
    const refund = zodAction(z.object({}), async () => 'done', { permission: 'orders.refund' });
    expect(await refund({})).toEqual({ ok: false, fieldErrors: {}, formError: 'forbidden' });
  });
});
