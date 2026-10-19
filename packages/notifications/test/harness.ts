// Test harness: a real HTTP server on a random port that serves the module's route handlers and mocks
// at the same paths the app does, so the adapters talk HTTP end to end (mock mode uses INTERNAL_BASE_URL).
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setAuthProvider } from '@ecomkit/core/auth-context';
import type { AuthContext, StaffViewer } from '@ecomkit/core/contracts';
import { resetEnv } from '@ecomkit/core/env';
import { ensureQueue, getBoss } from '@ecomkit/core/jobs';
import * as gmailMock from '../src/mocks/gmail';
import * as metaMock from '../src/mocks/meta';
import { gmailCallback } from '../src/server/gmail-oauth';
import { receiveWebhook, verifyWebhook } from '../src/server/whatsapp';

type Handler = (req: Request) => Promise<Response>;

function route(method: string, path: string): Handler | null {
  if (path.startsWith('/api/_mock/meta/')) return method === 'GET' ? metaMock.GET : metaMock.POST;
  if (path.startsWith('/api/_mock/gmail/')) return method === 'GET' ? gmailMock.GET : gmailMock.POST;
  if (path === '/api/webhooks/whatsapp') return method === 'GET' ? verifyWebhook : receiveWebhook;
  if (path === '/api/auth/gmail/callback') return gmailCallback;
  return null;
}

export async function startHarness(): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = new URL(req.url ?? '/', origin);
    const handler = route(req.method ?? 'GET', url.pathname);
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    try {
      const response = await handler(new Request(url, { method: req.method, headers, ...(body && req.method !== 'GET' ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.INTERNAL_BASE_URL = origin;
  resetEnv();
  return { origin, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Env every test file needs before createTestDb. */
export function testEnv(): void {
  process.env.INTERNAL_SECRET = 'n'.repeat(40);
  process.env.SETTINGS_MASTER_KEY = `1:${randomBytes(32).toString('base64')}`;
  process.env.ENABLE_MOCKS = '1';
  delete process.env.SITE_URL;
  resetEnv();
}

export async function createQueues(): Promise<void> {
  const boss = await getBoss();
  for (const q of ['notifications.deliver', 'notifications.process-webhook', 'core.event']) await ensureQueue(boss, q);
}

export const STAFF: StaffViewer = { kind: 'staff', userId: '0192a000-0000-7000-8000-000000000001', name: 'Owner', email: 'owner@example.test', role: 'owner', permissions: ['settings.read', 'settings.write', 'settings.secrets'] };

/** Signs a staff viewer in for permission checks (or signs everyone out with null). */
export function signIn(viewer: StaffViewer | null): void {
  const auth: AuthContext = {
    getViewer: async () => viewer ?? { kind: 'guest' },
    requirePermission: async (p) => {
      if (!viewer || !viewer.permissions.includes(p)) {
        const { ForbiddenError } = await import('@ecomkit/core/auth-context');
        throw new ForbiddenError();
      }
      return viewer;
    },
    requireOwner: async () => {
      throw new Error('not used');
    },
  };
  setAuthProvider(async () => auth);
}
