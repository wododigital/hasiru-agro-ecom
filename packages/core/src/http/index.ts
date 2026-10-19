import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { emit } from '../events';
import { db } from '../db';
import { coreIntegrationLog } from '../schema';

export { signHmacSha256, signInternal, timingSafeEqual, verifyHmacSha256, verifyInternal } from './hmac';
export { clientIp, derivedSecret, hashIp } from './secrets';

export { PayloadTooLargeError, readRawBody } from './raw-body';

// ---- SSRF guard -----------------------------------------------------------

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** True only for globally routable unicast addresses. IPv4-mapped IPv6 is judged by its IPv4 part. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return !blocked.check(mapped[1]!, 'ipv4');
  if (/^::ffff:/i.test(ip)) return false; // hex-form mapped address: refuse rather than decode
  return !blocked.check(ip, 'ipv6');
}

/** Resolves like dns.lookup but fails when any address for the host is not public (checked at connect time, so DNS rebinding cannot slip in). */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 4);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || addresses.length === 0) {
      return callback(new SsrfError(`${hostname} resolves to a non-public address`) as NodeJS.ErrnoException, '', 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

export interface SafeFetchOptions {
  /** Exact hosts, or `*.example.com` for subdomains. Omit only for admin-entered URLs that are checked by address alone. */
  allowHosts?: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array | URLSearchParams | null;
  signal?: AbortSignal;
}

function checkUrl(raw: string | URL, allowHosts: readonly string[] | undefined): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new SsrfError(`only https is allowed (${url.protocol})`);
  if (url.username || url.password) throw new SsrfError('credentials in the URL are not allowed');
  if (url.port && url.port !== '443') throw new SsrfError(`port ${url.port} is not allowed`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (allowHosts && !allowHosts.some((h) => (h.startsWith('*.') ? host.endsWith(h.slice(1)) : host === h.toLowerCase()))) {
    throw new SsrfError(`host ${host} is not in the allowlist`);
  }
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !isPublicAddress(literal)) throw new SsrfError(`${host} is not a public address`);
  return url;
}

function once(url: URL, init: SafeFetchInit, signal: AbortSignal, maxBytes: number): Promise<{ status: number; headers: Headers; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers);
    const body = init.body == null ? undefined : init.body instanceof URLSearchParams ? init.body.toString() : init.body;
    if (init.body instanceof URLSearchParams && !headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    const req = httpsRequest(url, { method: init.method ?? 'GET', headers: Object.fromEntries(headers), lookup: guardedLookup, signal }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) req.destroy(new Error(`response exceeds ${maxBytes} bytes`));
        else chunks.push(c);
      });
      res.on('end', () => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * fetch for outbound calls to third parties: https on 443 only, optional host allowlist, every resolved
 * address must be public (checked when connecting), redirects followed manually and re-checked,
 * timeout (default 10 s) and response size cap (default 10 MB). Returns a standard Response.
 */
export async function safeFetch(input: string | URL, init: SafeFetchInit = {}, options: SafeFetchOptions = {}): Promise<Response> {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(init.signal ? [init.signal] : [])]);
  let url = checkUrl(input, options.allowHosts);
  let current = init;
  for (let hop = 0; ; hop++) {
    const res = await once(url, current, signal, options.maxBytes ?? 10 * 1024 * 1024);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= (options.maxRedirects ?? 3)) throw new SsrfError('too many redirects');
      const next = checkUrl(new URL(location, url), options.allowHosts);
      const method = (current.method ?? 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) current = { ...current, method: 'GET', body: null };
      if (next.origin !== url.origin) {
        // Never forward credentials (Authorization, cookies, API-key headers) or a body to another origin.
        if (current.body != null) throw new SsrfError('cross-origin redirect of a request with a body');
        current = { ...current, headers: undefined };
      }
      url = next;
      continue;
    }
    const empty = res.status === 204 || res.status === 304 || res.status < 200;
    return new Response(empty ? null : new Uint8Array(res.body), { status: res.status, headers: res.headers });
  }
}

// ---- Integration log ------------------------------------------------------

/** Throw from an integration call when the provider has no credentials: logged as skipped, not as a failure. */
export class NotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured`);
    this.name = 'NotConfiguredError';
  }
}

export type IntegrationResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'skipped_not_configured' }
  | { status: 'failed'; error: Error };

/**
 * Wraps one call to an external provider: times it, writes a `core_integration_log` row
 * (ok / failed / skipped_not_configured) and emits `integration.failed` on failure. Never throws.
 */
export async function integrationCall<T>(provider: string, op: string, fn: () => Promise<T>, options: { ref?: string } = {}): Promise<IntegrationResult<T>> {
  const started = performance.now();
  let result: IntegrationResult<T>;
  try {
    result = { status: 'ok', value: await fn() };
  } catch (err) {
    result = err instanceof NotConfiguredError ? { status: 'skipped_not_configured' } : { status: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
  const value = result.status === 'ok' ? result.value : undefined;
  const failure = result.status === 'failed' ? result.error : undefined;
  const httpStatus = value instanceof Response ? value.status : (failure as { status?: unknown } | undefined)?.status;
  try {
    await db.insert(coreIntegrationLog).values({
      provider,
      op,
      status: result.status,
      durationMs: Math.round(performance.now() - started),
      httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
      error: failure ? failure.message.slice(0, 1000) : null,
      ref: options.ref ?? null,
    });
    if (failure) await emit('integration.failed', { provider, operation: op, error: failure.message.slice(0, 500) });
  } catch (logErr) {
    process.stderr.write(`${JSON.stringify({ level: 'error', scope: 'integration', provider, op, message: 'could not log integration call', error: String(logErr) })}\n`);
  }
  return result;
}
