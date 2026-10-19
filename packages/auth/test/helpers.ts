import { createHmac } from 'node:crypto';
import type { OutboundMessage } from '@ecomkit/core/contracts';
import { createTestDb, fakeNotificationChannel, type TestDb } from '@ecomkit/core/testing';
import { configureAuth } from '../src/server/config';

export const BASE_URL = 'http://localhost:3000';

/** Real Postgres with core + auth schemas, auth wired to the core fake channel and a switchable request. */
export async function setupAuthDb(name: string): Promise<{
  t: TestDb;
  sent: OutboundMessage[];
  as(jar: Jar | null): void;
}> {
  process.env.INTERNAL_SECRET = 's'.repeat(48);
  const t = await createTestDb(name, { schemas: ['core', 'auth'] });
  const channel = fakeNotificationChannel('log');
  let current: Jar | null = null;
  configureAuth({ channel, baseURL: BASE_URL, appName: 'Test Store', headers: async () => (current ? current.headers() : new Headers()) });
  return { t, sent: channel.sent, as: (jar) => void (current = jar) };
}

/** A browser cookie jar fed from Better Auth Set-Cookie headers. */
export class Jar {
  private cookies = new Map<string, string>();
  constructor(readonly ip = '203.0.113.10') {}
  apply(headers: Headers): this {
    for (const line of headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }
  headers(): Headers {
    const h = new Headers({ 'x-real-ip': this.ip, origin: BASE_URL, 'user-agent': 'vitest' });
    if (this.cookies.size) h.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    return h;
  }
}

/** The value of `<key>: <value>` in a fake-channel message (the raw-channel fallback renders vars as lines). */
export function varOf(message: OutboundMessage | undefined, key: string): string {
  const match = message?.text.match(new RegExp(`^${key}: (.+)$`, 'm'));
  if (!match?.[1]) throw new Error(`no ${key} in message: ${message?.text}`);
  return match[1];
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), what an authenticator app shows for this base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
