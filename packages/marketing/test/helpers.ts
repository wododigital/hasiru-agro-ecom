import { randomBytes } from 'node:crypto';
import { ForbiddenError, setAuthProvider } from '@ecomkit/core/auth-context';
import { ROLE_PERMISSIONS, type AuthContext, type CustomerViewer, type StaffViewer, type Viewer } from '@ecomkit/core/contracts';
import { resetEnv } from '@ecomkit/core/env';
import { newId } from '@ecomkit/core/ids';
import type { ConversionOrder } from '../src/domain/conversions';
import * as ga4Mock from '../src/mocks/ga4';
import * as capiMock from '../src/mocks/meta-capi';

export function testEnv(): void {
  process.env.INTERNAL_SECRET = 'm'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  process.env.SITE_URL = 'https://shop.example';
  resetEnv();
}

export const MANAGER: StaffViewer = { kind: 'staff', userId: newId(), name: 'Manager', email: 'manager@example.test', role: 'manager', permissions: ROLE_PERMISSIONS.manager };
export const SUPPORT: StaffViewer = { kind: 'staff', userId: newId(), name: 'Support', email: 'support@example.test', role: 'support', permissions: ROLE_PERMISSIONS.support };
export const customer = (): CustomerViewer => {
  const id = newId();
  return { kind: 'customer', userId: id, customerId: id, name: 'Asha', phone: '+919845012345', email: 'asha@example.test' };
};

export function signInAs(viewer: Viewer): void {
  const auth: AuthContext = {
    getViewer: async () => viewer,
    requirePermission: async (perm) => {
      if (viewer.kind !== 'staff' || !viewer.permissions.includes(perm)) throw new ForbiddenError();
      return viewer;
    },
    requireOwner: async () => {
      throw new ForbiddenError();
    },
  };
  setAuthProvider(async () => auth);
}

/** Routes the vendor calls to the in-package mock handlers (the same code the app mounts under /api/_mock). */
export async function mockHttp(url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<Response> {
  const req = new Request(url, init);
  const path = new URL(url).pathname;
  if (path.startsWith('/api/_mock/ga4/')) return ga4Mock.POST(req);
  if (path.startsWith('/api/_mock/meta-capi/')) return capiMock.POST(req);
  return new Response(null, { status: 404 });
}

export function order(over: Partial<ConversionOrder> = {}): ConversionOrder {
  const orderId = over.orderId ?? newId();
  return {
    orderId,
    orderNumber: 'ORD-2610-00042',
    valuePaise: 249_900,
    currency: 'INR',
    isTest: false,
    placedAt: new Date(Date.now() - 60_000),
    lines: [
      { productId: newId(), variantId: newId(), sku: 'PLT-0001-01', name: 'Sample Sapling', qty: 2, unitPaise: 99_950 },
      { productId: newId(), variantId: newId(), sku: 'INP-0002-01', name: 'Sample Compost 25 kg', qty: 1, unitPaise: 50_000 },
    ],
    shippingPaise: 0,
    taxPaise: 11_900,
    couponCode: null,
    customerId: newId(),
    contact: { email: ' Buyer@Example.COM ', phone: '+91 98450 12345', firstName: 'Asha', lastName: 'Rao', city: 'Sample City', state: 'Sample State', pincode: '560 001', country: 'IN' },
    sourceUrl: 'https://shop.example/order/abc',
    ...over,
  };
}
