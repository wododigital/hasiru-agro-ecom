#!/usr/bin/env node
// Smoke test against a running apps/shop (plain Node 22 fetch, no deps).
//   node tooling/smoke.mjs [--base=http://localhost:3131] [--only=routes,money,jobs,admin] [--cookie='ek.session_token=...']
//                          [--strict] [--max-links=400]
// env: BASE_URL, SMOKE_COOKIE, DATABASE_URL (DB assertions + owner session minting, via psql), INTERNAL_SECRET
//      (mints a signed owner session cookie and signs the mock PhonePe webhook; must match the server's).
// Result per check: PASS, FAIL, or SKIP (feature not assembled / no data). --strict turns SKIP into failure.
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const BASE = (arg('base', process.env.BASE_URL) ?? 'http://localhost:3131').replace(/\/$/, '');
const ONLY = new Set(arg('only', 'routes,money,jobs,admin').split(','));
const STRICT = process.argv.includes('--strict');
const MAX_LINKS = Number(arg('max-links', '400'));
const DB = process.env.DATABASE_URL;
const SECRET = process.env.INTERNAL_SECRET;
const results = [];
// One client IP per run (TEST-NET-2), set the way nginx sets X-Real-IP, so per-IP limits do not carry over between runs.
const SMOKE_IP = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
const rec = (section, name, status, detail = '') => results.push({ section, name, status, detail: String(detail).slice(0, 140) });

// ---------- helpers ----------
/** psql query -> rows of string cells; null when no DB or the query fails (missing table = feature not assembled). */
function sql(q) {
  if (!DB) return null;
  const r = spawnSync('psql', [DB, '-AtF', '\t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim() ? r.stdout.trim().split('\n').map((l) => l.split('\t')) : [];
}
const one = (q) => sql(q)?.[0]?.[0] ?? null;
const tableExists = (t) => one(`select to_regclass('public.${t}') is not null`) === 't';
const count = (q) => Number(one(q) ?? 'NaN');

const jar = new Map(); // shared cookie jar (cart, session)
function setCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
}
const cookieHeader = (extra = '') => [...[...jar].map(([k, v]) => `${k}=${v}`), extra].filter(Boolean).join('; ');

async function req(path, { method = 'GET', body, headers = {}, admin = false } = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  try {
    const res = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      headers: { origin: BASE, cookie: cookieHeader(admin ? OWNER_COOKIE : ''), 'user-agent': 'ecomkit-smoke', 'x-real-ip': SMOKE_IP, ...headers },
      signal: AbortSignal.timeout(30000),
    });
    setCookies(res);
    const type = res.headers.get('content-type') ?? '';
    const text = type.includes('html') || type.includes('json') || type.includes('xml') || type.includes('text') ? await res.text() : (await res.arrayBuffer(), '');
    return { status: res.status, location: res.headers.get('location'), type, text };
  } catch (err) {
    return { status: 0, location: null, type: '', text: '', error: err.message };
  }
}
const json = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}
// HTML attributes plus the RSC payload (streamed/PPR content carries links as \"href\":\"/x\")
const hrefs = (html) =>
  [...html.matchAll(/\shref="([^"#]*)"|\\?"href\\?":\\?"(\/[^"\\#]*)/g)]
    .map((m) => (m[1] ?? m[2]).replaceAll('&amp;', '&'))
    .filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/_next/'));

/** All <form>s of a page with their fields (hidden + named inputs/selects/textareas). Server-action forms carry $ACTION_ID_*. */
function forms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs, inner]) => {
    const fields = [];
    for (const [, tag, a] of inner.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const name = /\sname="([^"]*)"/.exec(a)?.[1];
      if (!name) continue;
      const type = /\stype="([^"]*)"/.exec(a)?.[1] ?? '';
      if ((type === 'checkbox' || type === 'radio') && !/\schecked/.test(a)) continue;
      fields.push([name, (/\svalue="([^"]*)"/.exec(a)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&quot;', '"')]);
    }
    return { action: /\saction="([^"]*)"/.exec(attrs)?.[1] ?? '', text: inner.replace(/<[^>]+>/g, ' '), fields };
  });
}
/** Finds a form on `page` whose text matches `match`, overrides fields, and posts it (no-JS server action contract). */
async function submitForm(page, match, overrides = {}, { admin = true, waitMs = 0 } = {}) {
  const r = await req(page, { admin });
  if (r.status !== 200) return { skipped: `GET ${page} -> ${r.status || r.error}` };
  const f = forms(r.text).find((x) => match.test(x.text) || x.fields.some(([n]) => match.test(n)));
  if (!f) return { skipped: `no form matching ${match} on ${page}` };
  const fd = new FormData();
  const seen = new Set();
  for (const [k, v] of f.fields) {
    if (k in overrides) {
      if (!seen.has(k)) fd.append(k, overrides[k]);
      seen.add(k);
    } else fd.append(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) if (!seen.has(k)) fd.append(k, v);
  const target = f.action && !f.action.startsWith('javascript') ? f.action : page;
  if (waitMs) await new Promise((r) => setTimeout(r, waitMs)); // form guards reject instant submits
  return { res: await req(target, { method: 'POST', body: fd, admin }), form: f };
}

// ---------- owner session ----------
let OWNER_COOKIE = arg('cookie', process.env.SMOKE_COOKIE) ?? '';
function mintOwnerCookie() {
  if (OWNER_COOKIE || !DB || !SECRET) return;
  OWNER_COOKIE = mintCookie('owner') ?? '';
}
function mintCookie(role) {
  if (!DB || !SECRET) return null;
  const email = role === 'owner' ? 'smoke-owner@example.invalid' : `smoke-${role}@example.invalid`;
  const secret = createHmac('sha256', SECRET).update('ecomkit:better-auth').digest().toString('base64url');
  const token = randomBytes(24).toString('base64url');
  const ok = sql(`
    insert into auth_user (id, name, email, email_verified, role, two_factor_enabled, created_at, updated_at)
      values ('${randomUUID()}', 'Smoke ${role}', '${email}', true, '${role}', true, now(), now())
      on conflict (email) do update set role = '${role}', two_factor_enabled = true, banned = false;
    insert into auth_session (id, token, user_id, expires_at, created_at, updated_at)
      select '${randomUUID()}', '${token}', id, now() + interval '1 day', now(), now() from auth_user where email = '${email}';`);
  if (ok === null) return null;
  const sig = createHmac('sha256', secret).update(token).digest('base64');
  return `ek.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
}

// ---------- route manifest ----------
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), acc);
    else if (/^(page|route)\.tsx?$/.test(e.name)) acc.push(join(dir, e.name));
  }
  return acc;
}
function routeManifest() {
  const app = join(ROOT, 'apps/shop/app');
  const fsRoutes = walk(app).map((f) =>
    '/' + f.slice(app.length + 1).split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/'),
  );
  const modRoutes = [];
  for (const p of readdirSync(join(ROOT, 'packages'))) {
    const m = join(ROOT, 'packages', p, 'src/manifest.ts');
    if (existsSync(m)) for (const [, path] of readFileSync(m, 'utf8').matchAll(/path:\s*'(\/[^']*)'/g)) modRoutes.push(path);
  }
  const all = new Map();
  for (const r of fsRoutes) all.set(r.replace(/\/$/, '') || '/', 'app');
  for (const r of modRoutes) if (!all.has(r)) all.set(r, 'module');
  // the [...slug] catch-all and _mock helpers are not routes to probe directly
  for (const k of [...all.keys()]) if (k === '/[...slug]' || k.includes('/_mock/')) all.delete(k);
  return all;
}
const toRegex = (pattern) =>
  new RegExp('^' + pattern.replace(/[.]/g, '\\.').replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '$');

async function sitemapPaths() {
  const out = new Set();
  const seen = new Set();
  const visit = async (u) => {
    if (seen.has(u) || seen.size > 30) return;
    seen.add(u);
    const r = await req(u);
    if (r.status !== 200) return;
    for (const [, loc] of r.text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const p = new URL(loc.trim()).pathname;
      if (p.endsWith('.xml')) await visit(p);
      else out.add(p);
    }
  };
  await visit('/sitemap.xml');
  return out;
}

// ---------- sections ----------
async function routes() {
  const S = 'routes';
  const manifest = routeManifest();
  const samples = await sitemapPaths();
  rec(S, 'sitemap.xml lists URLs', samples.size ? 'PASS' : 'SKIP', `${samples.size} urls (empty catalog seed?)`);
  const targets = []; // [path, pattern, origin]
  for (const [pattern, origin] of manifest) {
    if (!pattern.includes('[')) {
      targets.push([pattern, pattern, origin]);
      continue;
    }
    const re = toRegex(pattern);
    const hits = [...samples].filter((p) => re.test(p)).slice(0, 3);
    for (const h of hits) targets.push([h, pattern, origin]);
    // an unknown slug must be a clean 404, never a 5xx
    if (!pattern.startsWith('/admin') && !pattern.startsWith('/api')) targets.push([pattern.replace(/\[(\.\.\.)?[^\]]+\]/g, 'zz-smoke-missing'), pattern, origin]);
    if (!hits.length && !pattern.startsWith('/api') && !pattern.startsWith('/admin')) rec(S, pattern, 'SKIP', 'no seeded sample (sitemap/admin links)');
  }
  const html = [];
  await pool(targets, 6, async ([path, pattern, origin]) => {
    const admin = path.startsWith('/admin') && path !== '/admin/login';
    const r = await req(path, { admin });
    const missing = path.includes('zz-smoke-missing');
    let status = r.status >= 200 && r.status < 400 ? 'PASS' : r.status === 404 ? 'PASS' : r.status === 0 || r.status >= 500 ? 'FAIL' : 'PASS';
    let detail = `${r.status || r.error}${r.location ? ' -> ' + r.location : ''}`;
    if (path === '/api/health/ready' && r.status === 503) {
      status = 'SKIP';
      detail += ' (not ready: start the worker for job heartbeats)';
    } else if (admin && (r.status === 404 || /\/admin\/login/.test(r.location ?? ''))) {
      // admin pages 404 for anyone without permission: with an owner cookie that means "not authenticated" or "not assembled"
      status = OWNER_COOKIE ? (origin === 'module' && r.status === 404 ? 'SKIP' : 'FAIL') : 'SKIP';
      detail += OWNER_COOKIE ? (status === 'SKIP' ? ' (module route not assembled)' : ' (owner cookie rejected?)') : ' (no owner cookie)';
    } else if (r.status === 404 && origin === 'module' && !missing && !pattern.includes('[')) {
      status = 'SKIP';
      detail += ' (module route not assembled)';
    } else if (r.status === 200 && /\d+:E\{\\?"digest\\?":\\?"(?!NEXT_)/.test(r.text)) {
      // a server error inside a streamed Suspense boundary still answers 200; the RSC payload carries E{digest} (NEXT_* digests are notFound/redirect)
      status = 'FAIL';
      detail += ' (render error inside a Suspense boundary: see server log for the digest)';
    } else if (missing && r.status !== 404 && r.status < 500 && r.status >= 200 && r.status < 300 && !pattern.startsWith('/admin')) {
      detail += ' (unknown slug did not 404)';
    }
    rec(S, `${admin ? '[admin] ' : ''}${path}`, status, detail);
    if (r.status === 200 && r.type.includes('html')) html.push([path, r.text, admin]);
  });
  // second pass: admin detail pages discovered from list pages (one per dynamic admin pattern)
  const adminDyn = [...manifest.keys()].filter((p) => p.startsWith('/admin') && p.includes('['));
  const links = new Set(html.flatMap(([, t]) => hrefs(t)).map((h) => h.split('?')[0]));
  const extra = [];
  for (const p of adminDyn) {
    const hit = [...links].find((l) => toRegex(p).test(l));
    if (hit) extra.push(hit);
    else rec(S, `[admin] ${p}`, 'SKIP', 'no link to a record found on list pages');
  }
  await pool(extra, 4, async (path) => {
    const r = await req(path, { admin: true });
    rec(S, `[admin] ${path}`, r.status === 200 ? 'PASS' : 'FAIL', `${r.status || r.error}${r.location ? ' -> ' + r.location : ''}`);
    if (r.status === 200) html.push([path, r.text, true]);
  });
  // internal hrefs found in returned HTML resolve to non-5xx
  const probed = new Set(targets.map(([p]) => p).concat(extra));
  const todo = [...new Map(html.flatMap(([from, t, admin]) => hrefs(t).map((h) => [h, { from, admin }]))).entries()]
    .filter(([h]) => !probed.has(h.split('?')[0]) && !/\/sign-?out|logout/.test(h))
    .slice(0, MAX_LINKS);
  let bad = 0;
  await pool(todo, 8, async ([href, { from, admin }]) => {
    const r = await req(href, { admin });
    if (r.status === 0 || r.status >= 500) {
      bad++;
      rec(S, `link ${href}`, 'FAIL', `${r.status || r.error} (linked from ${from})`);
    } else if (r.status === 404 && !href.includes('zz-smoke')) rec(S, `link ${href}`, 'FAIL', `404 broken link (from ${from})`);
  });
  rec(S, `internal links (${todo.length} probed)`, bad ? 'FAIL' : 'PASS', bad ? `${bad} returned 5xx` : 'no 5xx');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls a SQL scalar until `ok(value)` or the timeout; returns the last value. */
async function until(q, ok, timeoutMs = 30000) {
  let v = one(q);
  for (const end = Date.now() + timeoutMs; !ok(v) && Date.now() < end; ) {
    await wait(1000);
    v = one(q);
  }
  return v;
}
// One phone per smoke run: flows cap messages per contact per 7 days, coupons per phone.
const SMOKE_PHONE = `98${String(Date.now()).slice(-8)}`;
const E164 = `+91${SMOKE_PHONE}`;
const BUYER = { name: 'Smoke Buyer', phone: SMOKE_PHONE, email: `smoke-${SMOKE_PHONE}@example.invalid` };
const newCart = () => jar.delete('cart');
const addLine = (variantId, delta) => req('/api/cart/lines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId, delta }) });
const purchasable = (minFree) =>
  sql(`select v.id from catalog_variant v join catalog_product p on p.id = v.product_id and p.status = 'active' and p.deleted_at is null
    join pricing_price pp on pp.variant_id = v.id join inventory_level l on l.variant_id = v.id
    where l.on_hand - l.reserved >= ${minFree} and l.ready_in_days is null order by l.on_hand desc limit 3`)?.map((r) => r[0]) ?? [];
const level = (v) => sql(`select on_hand, reserved from inventory_level where variant_id = '${v}'`)?.[0]?.map(Number) ?? [NaN, NaN];
/** The no-JS checkout post (React form action): the form's own hidden fields plus the buyer's answers. */
function placeOrder(extra = {}) {
  return submitForm('/checkout', /^idempotencyKey$/, { ...BUYER, policyAck: '1', paymentChoice: 'online', expectedTotalPaise: '', ...extra }, { admin: false });
}
const latestOrder = (since) => sql(`select id, status, total_paise, tax_paise, shipping_paise, coupon_paise, reservation_id from orders_order where created_at >= '${since}' order by created_at desc limit 1`)?.[0] ?? null;

async function money() {
  const S = 'money';
  const missing = ['cart_cart', 'orders_order', 'payments_attempt'].filter((t) => DB && !tableExists(t));
  if (missing.length) return rec(S, 'money path', 'SKIP', `tables missing (modules not enabled in modules.config): ${missing.join(', ')}`);
  if (!DB) return rec(S, 'money path', 'SKIP', 'DATABASE_URL not set (assertions read the database)');
  const cartApi = await req('/api/cart');
  if (cartApi.status === 404) return rec(S, 'money path', 'SKIP', '/api/cart not assembled');
  const [variant] = purchasable(20);
  if (!variant) return rec(S, 'money path', 'SKIP', 'no seeded purchasable variant (price + stock)');
  const local = one(`select id from shipping_method where kind = 'local_slot' limit 1`);
  const [onHand0, reserved0] = level(variant);

  // cart
  newCart();
  const unknown = await addLine(randomUUID(), 1);
  rec(S, 'unknown variant refused', unknown.status === 404 ? 'PASS' : 'FAIL', `${unknown.status} ${unknown.text.slice(0, 60)}`);
  const add = await addLine(variant, 10);
  rec(S, 'add to cart', add.status === 200 && json(add)?.qty === 10 ? 'PASS' : 'FAIL', `${add.status} ${add.text.slice(0, 80)}`);

  // coupon: a live 10% code rule, applied through the cart page's no-JS coupon form
  const code = `SMOKE${SMOKE_PHONE.slice(-6)}`;
  sql(`with r as (insert into discounts_rule (id, name, kind, status, value_type, value) values ('${randomUUID()}', 'Smoke 10%', 'code', 'active', 'percent', 10) returning id)
    insert into discounts_code (id, rule_id, code) select '${randomUUID()}', id, '${code}' from r`);
  const cp = await submitForm('/cart', /^code$/, { code }, { admin: false });
  const stored = one(`select coupon_code from cart_cart where coupon_code = '${code}' and status = 'active' limit 1`);
  rec(S, 'coupon applied', stored === code ? 'PASS' : 'FAIL', cp.skipped ?? `POST ${cp.res.status}, cart coupon ${stored}`);
  const quote = json(await req('/api/cart'));
  rec(S, 'cart quote', quote?.count === 10 && quote?.total ? 'PASS' : 'FAIL', JSON.stringify({ count: quote?.count, total: quote?.total }));

  // checkout: local delivery in Bengaluru (delivery charge + 18% GST on charges), online payment
  const since = one('select now()');
  const placed = await placeOrder({ methodId: local ?? '', pincode: '560060', line1: '1 Test Road', villageTown: 'Kengeri', district: 'Bengaluru Urban', districtSlug: 'bengaluru-urban', state: 'Karnataka', stateCode: 'KA', marketingConsent: 'on' });
  if (placed.skipped) return rec(S, 'place order', 'FAIL', placed.skipped);
  const order = latestOrder(since);
  rec(S, 'place order', order ? 'PASS' : 'FAIL', order ? `order ${order[0]} ${order[1]}` : `POST /checkout -> ${placed.res.status} ${placed.res.location ?? ''}`);
  if (!order) return;
  const [orderId, , total, tax, shipping, coupon, reservationId] = order;
  rec(S, 'order totals: delivery + GST + coupon', Number(shipping) > 0 && Number(tax) > 0 && Number(coupon) > 0 ? 'PASS' : 'FAIL', `total ${total} shipping ${shipping} tax ${tax} coupon ${coupon}`);
  rec(S, 'coupon redeemed', count(`select count(*) from discounts_redemption where order_id = '${orderId}'`) > 0 ? 'PASS' : 'FAIL');
  const [, reserved1] = level(variant);
  const held = one(`select status from inventory_reservation where id::text = '${reservationId}'`);
  rec(S, 'stock reserved', held === 'held' && reserved1 === reserved0 + 10 ? 'PASS' : 'FAIL', `reservation ${held}, reserved ${reserved0} -> ${reserved1}`);

  // mock PhonePe: the buyer pays on the mock pay page; the mock posts a signed webhook; the worker applies it
  const attempt = sql(`select id, merchant_order_id, redirect_url from payments_attempt where order_id = '${orderId}' order by attempt_no desc limit 1`)?.[0];
  if (!attempt) return rec(S, 'payment attempt', 'FAIL', 'no payments_attempt row');
  rec(S, 'payment attempt (mock PhonePe)', attempt[2]?.includes('/api/_mock/phonepe/paypage') ? 'PASS' : 'FAIL', attempt[2] ?? '');
  const pay = await req('/api/_mock/phonepe/paypage', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ o: attempt[1], outcome: 'success' }).toString() });
  rec(S, 'mock pay page: success', pay.status === 303 ? 'PASS' : 'FAIL', `${pay.status} -> ${pay.location ?? ''}`);
  const signed = await until(`select count(*) from payments_webhook_event where signature_ok and payload->'payload'->>'merchantOrderId' = '${attempt[1]}'`, (v) => Number(v) > 0, 15000);
  rec(S, 'signed webhook received', Number(signed) > 0 ? 'PASS' : 'FAIL', `${signed} signed events`);
  const status = await until(`select status from orders_order where id = '${orderId}'`, (v) => v === 'paid', 45000);
  rec(S, 'order paid', status === 'paid' ? 'PASS' : 'FAIL', status || 'no row (is the worker running?)');
  const [onHand2, reserved2] = level(variant);
  const committed = one(`select status from inventory_reservation where id::text = '${reservationId}'`);
  rec(S, 'stock committed', committed === 'committed' && onHand2 === onHand0 - 10 && reserved2 === reserved0 ? 'PASS' : 'FAIL', `reservation ${committed}, on hand ${onHand0} -> ${onHand2}, reserved ${reserved2}`);
  const invoice = await until(`select count(*) from orders_invoice where order_id = '${orderId}'`, (v) => Number(v) > 0, 90000);
  rec(S, 'invoice issued', Number(invoice) > 0 ? 'PASS' : 'FAIL');
  for (const ch of ['email', 'whatsapp']) {
    const n = await until(`select count(*) from notifications_message where order_id = '${orderId}' and channel = '${ch}'`, (v) => Number(v) > 0, 30000);
    rec(S, `notification queued (${ch})`, Number(n) > 0 ? 'PASS' : 'FAIL', `${n} messages: ${(sql(`select template_key || ':' || status from notifications_message where order_id = '${orderId}' and channel = '${ch}'`) ?? []).map((r) => r[0]).join(', ')}`);
  }
  const conv = await until(`select count(*) from marketing_conversion_event where order_id = '${orderId}'`, (v) => Number(v) > 0, 30000);
  rec(S, 'conversion recorded (marketing)', Number(conv) > 0 ? 'PASS' : 'FAIL', (sql(`select destination || ':' || status from marketing_conversion_event where order_id = '${orderId}'`) ?? []).map((r) => r[0]).join(', '));

  // failure path: payment fails, the window closes, the sweep cancels the order and releases the hold
  newCart();
  await addLine(variant, 2);
  const since2 = one('select now()');
  await placeOrder({ methodId: one(`select id from shipping_method where kind = 'pickup' limit 1`) ?? '' });
  const failed = latestOrder(since2);
  const fa = failed && sql(`select merchant_order_id from payments_attempt where order_id = '${failed[0]}' order by attempt_no desc limit 1`)?.[0]?.[0];
  if (!fa) rec(S, 'failed payment releases stock', 'FAIL', 'second order or attempt missing');
  else {
    await req('/api/_mock/phonepe/paypage', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ o: fa, outcome: 'fail' }).toString() });
    await until(`select state from payments_attempt where merchant_order_id = '${fa}'`, (v) => v === 'failed', 30000);
    sql(`update payments_attempt set expires_at = now() - interval '1 minute' where order_id = '${failed[0]}'`); // the payment window closes
    const st = await until(`select status from orders_order where id = '${failed[0]}'`, (v) => v === 'cancelled', 100000);
    const rel = one(`select status from inventory_reservation where id::text = '${failed[6]}'`);
    rec(S, 'failed payment cancels order, releases stock', st === 'cancelled' && rel === 'released' ? 'PASS' : 'FAIL', `order ${st}, reservation ${rel}`);
  }

  // oversell: more than the free stock is refused at place-order (no order, no hold)
  newCart();
  const [h, r] = level(variant);
  await addLine(variant, h - r + 5);
  const since3 = one('select now()');
  const over = await placeOrder({ methodId: one(`select id from shipping_method where kind = 'pickup' limit 1`) ?? '' });
  const none = latestOrder(since3);
  rec(S, 'oversell refused', !none && !over.skipped ? 'PASS' : 'FAIL', none ? `order ${none[0]} created` : over.skipped ?? `POST ${over.res.status}`);
  newCart();
}

/** A server action's id by export name, from the build the server runs (the checkout island calls these with JS). */
function actionId(name) {
  const p = join(ROOT, 'apps/shop/.next/server/server-reference-manifest.json');
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, 'utf8'));
  return Object.entries(m.node ?? {}).find(([, v]) => v.exportedName === name)?.[0] ?? null;
}
const callAction = (page, id, args) =>
  req(page, { method: 'POST', headers: { 'next-action': id, accept: 'text/x-component', 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(args) });

async function abandonedCart(S, since) {
  const save = actionId('saveContactAction');
  const tick = actionId('marketingConsentAction');
  if (!save || !tick) return rec(S, 'abandoned cart flow', 'SKIP', 'checkout actions not in apps/shop/.next (run against a next build)');
  const [v] = purchasable(5);
  if (!v) return rec(S, 'abandoned cart flow', 'SKIP', 'no purchasable variant');
  // Two fresh guests start checkout, type only a phone (the island autosaves it on blur through saveContactAction) and
  // leave before placing an order. One also ticks marketing consent. Distinct phones: flows cap runs per contact.
  const stamp = String(Date.now()).slice(-8);
  const leave = async (phone, consent) => {
    newCart();
    await addLine(v, 1);
    await req('/checkout'); // opens the checkout session for this cart
    const cartId = one(`select cart_id from checkout_session where created_at >= '${since}' and order_id is null order by created_at desc limit 1`);
    if (!cartId) return null;
    const saved = await callAction('/checkout', save, [{ name: 'Smoke Leaver', phone, email: '' }]);
    if (consent) await callAction('/checkout', tick, [true]);
    return { cartId, phone, saved: saved.status };
  };
  const quiet = await leave(`+9196${stamp}`, false);
  const keen = await leave(`+9197${stamp}`, true);
  if (!quiet || !keen) return rec(S, 'abandoned cart flow', 'FAIL', 'no checkout session for the cart');
  const noted = sql(`select id, contact_at is not null from cart_cart where id in ('${quiet.cartId}', '${keen.cartId}')`) ?? [];
  rec(S, 'checkout contact noted on the cart', noted.length === 2 && noted.every((r) => r[1] === 't') ? 'PASS' : 'FAIL', `saveContactAction ${quiet.saved}/${keen.saved}; ${noted.map((r) => r[1]).join(',')}`);
  sql(`update cart_cart set last_activity_at = now() - interval '2 days' where id in ('${quiet.cartId}', '${keen.cartId}')`);
  // The */5 cron can miss its minute on a loaded host; enqueue the same job once so the worker runs it now.
  sql(`insert into pgboss.job (name, data) values ('cart.mark-abandoned', '{}'::jsonb)`);
  const st = await until(`select string_agg(status::text, ',' order by id) from cart_cart where id in ('${quiet.cartId}', '${keen.cartId}')`, (x) => x === 'abandoned,abandoned', 330000);
  rec(S, 'cart marked abandoned (job)', st === 'abandoned,abandoned' ? 'PASS' : 'FAIL', st ?? '');
  const flagged = count(`select count(*) from pgboss.job where name = 'core.event' and data->>'event' = 'cart.abandoned' and data->'payload'->>'hasContact' = 'true' and data->'payload'->>'cartId' in ('${quiet.cartId}', '${keen.cartId}')`);
  rec(S, 'cart.abandoned carries hasContact', flagged === 2 ? 'PASS' : 'FAIL', `${flagged} of 2 events`);
  const runOf = (cartId) => until(`select r.id || ':' || r.status || ':' || coalesce(r.stop_reason::text, '') from flows_run r join flows_flow f on f.id = r.flow_id where f.key = 'abandoned_cart' and r.subject_id = '${cartId}'`, (x) => !!x, 30000);
  // No marketing consent: the run is recorded as stopped and nothing is sent (flows consent rule).
  const q = await runOf(quiet.cartId);
  const qMsgs = count(`select count(*) from notifications_message m join flows_run r on r.id = m.flow_run_id where r.subject_id = '${quiet.cartId}'`);
  rec(S, 'phone only, no consent: no reminder', q?.endsWith(':stopped:no_consent') && qMsgs === 0 ? 'PASS' : 'FAIL', `${q ?? 'no run'}, ${qMsgs} messages`);
  const run = await runOf(keen.cartId);
  const [runId, runStatus, stop] = (run ?? '::').split(':');
  rec(S, 'abandoned cart flow run started', runStatus === 'running' ? 'PASS' : 'FAIL', run ?? 'no run');
  if (runStatus !== 'running') return;
  // The first reminder waits an hour: move the run's clock back instead of waiting.
  sql(`update flows_run set started_at = now() - interval '4 hours', next_step_at = now() where id = '${runId}'`);
  const msg = await until(`select count(*) from notifications_message where flow_run_id = '${runId}' and template_key = 'cart.reminder_1'`, (x) => Number(x) > 0, 120000);
  rec(S, 'reminder queued', Number(msg) > 0 ? 'PASS' : 'FAIL', `${msg} cart.reminder_1 messages${stop ? ` (${stop})` : ''}`);
  const rendered = one(`select rendered::text from notifications_message where flow_run_id = '${runId}' limit 1`) ?? '';
  const link = /https?:\/\/[^\s"\\]+\/api\/cart\/restore\?t=[A-Za-z0-9._%-]+/.exec(rendered)?.[0];
  if (!link) return rec(S, 'restore link works', 'FAIL', 'no restore link in the message');
  newCart();
  const page = await req(link.replace(/^https?:\/\/[^/]+/, ''));
  const t = /name="t" value="([^"]+)"/.exec(page.text)?.[1]?.replaceAll('&#46;', '.');
  const post = t ? await req('/api/cart/restore', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t }).toString() }) : null;
  rec(S, 'restore link works', page.status === 200 && post?.status === 303 && post.location?.endsWith('/cart') ? 'PASS' : 'FAIL', `GET ${page.status}, POST ${post?.status} -> ${post?.location ?? ''}`);
  // The restored cart converts: the run stops as purchased and the next reminder never goes out, even when due.
  const local = one(`select id from shipping_method where kind = 'local_slot' limit 1`);
  const placed = await placeOrder({ methodId: local ?? '', pincode: '560060', line1: '1 Test Road', villageTown: 'Kengeri', district: 'Bengaluru Urban', districtSlug: 'bengaluru-urban', state: 'Karnataka', stateCode: 'KA', phone: keen.phone.slice(3), email: '' });
  const converted = await until(`select status from cart_cart where id = '${keen.cartId}'`, (x) => x === 'converted', 15000);
  rec(S, 'restored cart converts to an order', converted === 'converted' ? 'PASS' : 'FAIL', `${placed.skipped ?? placed.res?.status} cart ${converted}`);
  sql(`update flows_run set next_step_at = now() where id = '${runId}' and status = 'running'`);
  const after = await until(`select status || ':' || coalesce(stop_reason::text, '') from flows_run where id = '${runId}'`, (x) => x === 'stopped:purchased', 90000);
  const later = count(`select count(*) from notifications_message where flow_run_id = '${runId}' and template_key <> 'cart.reminder_1'`);
  rec(S, 'no reminder after the order', after === 'stopped:purchased' && later === 0 ? 'PASS' : 'FAIL', `run ${after}, ${later} later reminders`);
  newCart();
}

async function jobs() {
  const S = 'jobs';
  const since = one('select now()');
  // abandoned cart: guest carts with a phone saved at checkout go idle -> cart.mark-abandoned (every 5 min) ->
  // flows run (reminder only with marketing consent) -> first reminder with the restore link -> order stops the run.
  if (DB && !tableExists('flows_run')) rec(S, 'abandoned cart flow', 'SKIP', 'flows tables missing (module not enabled)');
  else if (DB) await abandonedCart(S, since);
  // notify-me
  // notify-me only accepts a variant that has an inventory level row
  const variant = one('select variant_id from inventory_level limit 1');
  if (!variant) rec(S, 'notify-me', 'SKIP', 'no inventory_level rows (seed data)');
  else {
    const r = await req('/api/notify-me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, channel: 'email', email: `smoke-notify-${SMOKE_PHONE}@example.invalid`, consent: true }) });
    const rows = count(`select count(*) from inventory_subscription where created_at >= '${since}'`);
    rec(S, 'notify-me', r.status < 300 && rows > 0 ? 'PASS' : r.status >= 500 || r.status === 0 ? 'FAIL' : 'FAIL', `${r.status} rows=${rows} ${r.text.slice(0, 80)}`);
  }
  // enquiry submit: the rendered form (carries the form-guard token) posted the no-JS way
  {
    const vals = { name: 'Smoke Enquirer', phone: '9876543210', email: 'smoke-enq@example.invalid', requirement: 'Smoke test enquiry', acres: '5', location: 'Bengaluru' };
    let s = await submitForm('/contact', /^phone$/, vals, { admin: false, waitMs: 3500 });
    if (s.skipped) s = await submitForm('/build-farm-with-us', /^phone$/, vals, { admin: false, waitMs: 3500 });
    const rows = count(`select count(*) from enquiries_enquiry where created_at >= '${since}'`);
    if (s.skipped) rec(S, 'enquiry submit', 'SKIP', s.skipped);
    else rec(S, 'enquiry submit', rows > 0 ? 'PASS' : 'FAIL', `${s.res.status}${s.res.location ? ' -> ' + s.res.location : ''} rows=${rows}`);
  }
  // wizard plan generate + soft unlock
  const gen = await req('/api/plan/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sqft: 43560, district: one('select slug from places_district order by (slug = \'bengaluru-urban\') desc limit 1') ?? 'bengaluru-urban', purpose: one('select slug from planting_model order by position limit 1') ?? 'fruit' }) });
  if (gen.status === 404) rec(S, 'wizard plan generate', 'SKIP', '/api/plan/generate not assembled');
  else {
    const planId = json(gen)?.planId ?? json(gen)?.id;
    rec(S, 'wizard plan generate', gen.status < 300 && planId ? 'PASS' : 'FAIL', `${gen.status} ${gen.text.slice(0, 80)}`);
    if (planId) {
      const un = await req('/api/plan/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: 'soft', planId, name: 'Smoke Farmer', phone: '9876543210' }) });
      rec(S, 'wizard plan unlock', un.status < 300 ? 'PASS' : 'FAIL', `${un.status} ${un.text.slice(0, 80)}`);
    }
  }
  // ERP sync against the mock + feed regeneration. The admin "Sync stock now" / "Rebuild feeds now" buttons are
  // JS-only settings actions that just enqueue these jobs; the smoke enqueues the same jobs and the worker runs them.
  for (const [name, queue, data, table] of [
    ['ERP sync now (mock)', 'erp-sync.pull-inventory', { force: true }, 'erp_sync_run'],
    ['feed regeneration', 'feeds.regenerate', {}, 'feeds_run'],
  ]) {
    if (!DB || !tableExists(table)) {
      rec(S, name, 'SKIP', `${table} missing (module not enabled)`);
      continue;
    }
    const before = count(`select count(*) from ${table}`);
    sql(`insert into pgboss.job (name, data) values ('${queue}', '${JSON.stringify(data)}'::jsonb)`);
    const after = Number(await until(`select count(*) from ${table}`, (x) => Number(x) > before, 60000));
    const last = one(`select row_to_json(t)::text from (select * from ${table} order by 1 desc limit 1) t`) ?? '';
    rec(S, name, after > before ? 'PASS' : 'FAIL', `${table} ${before} -> ${after} ${last.slice(0, 90)}`);
  }
  if (DB && tableExists('feeds_file')) {
    const token = one(`select value->>'token' from core_settings where module = 'feeds' limit 1`);
    const r = await req(`/feeds/google.xml${token ? `?token=${token}` : ''}`);
    rec(S, 'google feed served', r.status === 200 ? 'PASS' : r.status >= 500 ? 'FAIL' : 'SKIP', String(r.status));
  }
  // monitoring: repeated forged payment webhooks raise the critical developer alert
  for (let i = 0; i < 3; i++) await req('/api/webhooks/phonepe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'forged' }, body: '{}' });
  const al = await until(`select count(*) from monitoring_alert where rule_key = 'payments.webhook_signature' and status <> 'resolved'`, (x) => Number(x) > 0, 15000);
  rec(S, 'developer alert on payment failure', Number(al) > 0 ? 'PASS' : 'FAIL', `${al} open payments.webhook_signature alerts`);
  // sitemap lists products
  const idx = await req('/sitemap.xml');
  const files = [...idx.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''));
  let plants = 0;
  for (const f of files) plants += [...(await req(f)).text.matchAll(/<loc>[^<]*\/(?:plant|input)\/[^<]+<\/loc>/g)].length;
  rec(S, 'sitemap lists products', plants > 0 ? 'PASS' : 'FAIL', `${files.length} files, ${plants} product URLs`);
}

/** Links inside the admin sidebar (`<nav aria-label="Admin">`): the parent of every section, plus the open section's sub-entries. */
const sidebar = (html) => [...new Set([...html.matchAll(/<nav aria-label="Admin">([\s\S]*?)<\/nav>/g)].flatMap((m) => hrefs(m[1])))];
/** A 200 page whose RSC payload carries a non-Next error digest crashed inside a Suspense boundary. */
const renderError = (text) => /\d+:E\{\\?"digest\\?":\\?"(?!NEXT_)/.test(text);

async function admin() {
  const S = 'admin';
  if (!OWNER_COOKIE) return rec(S, 'admin saves', 'SKIP', 'no owner cookie (set SMOKE_COOKIE or DATABASE_URL + INTERNAL_SECRET)');
  const dash = await req('/admin', { admin: true });
  rec(S, 'owner session accepted', dash.status === 200 ? 'PASS' : 'FAIL', `${dash.status}${dash.location ? ' -> ' + dash.location : ''}`);
  if (dash.status !== 200) return;
  const auditBefore = count('select count(*) from core_audit_log');
  // settings: every module settings page, save the first one with its current values (round trip)
  const settings = await req('/admin/settings', { admin: true });
  const modules = [...new Set(hrefs(settings.text).filter((h) => /^\/admin\/settings\/[^/?]+$/.test(h)))];
  rec(S, 'settings sub-pages listed', modules.length ? 'PASS' : 'FAIL', modules.join(' ').slice(0, 140));
  const broken = [];
  await pool(modules, 6, async (m) => {
    const r = await req(m, { admin: true });
    if (r.status !== 200 || renderError(r.text) || !/<h1/.test(r.text)) broken.push(`${m} ${r.status}`);
  });
  rec(S, `every settings section renders (${modules.length})`, broken.length ? 'FAIL' : 'PASS', broken.join(' '));
  // role matrix: support (no settings/analytics/marketing permissions) sees neither the links nor the pages
  const support = mintCookie('support');
  if (!support) rec(S, 'role matrix (support)', 'SKIP', 'cannot mint a support session');
  else {
    const get = (path) => fetch(BASE + path, { redirect: 'manual', headers: { cookie: support }, signal: AbortSignal.timeout(30000) }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const home = await get('/admin');
    const leaked = ['/admin/settings', '/admin/analytics', '/admin/discounts'].filter((h) => hrefs(home.text).includes(h));
    rec(S, 'role matrix: support nav hides settings/analytics/discounts', home.status === 200 && !leaked.length ? 'PASS' : 'FAIL', `${home.status} leaked=${leaked.join(',')}`);
    const page = await get('/admin/settings/payments');
    const denied = page.status === 404 || /do not have access/i.test(page.text);
    rec(S, 'role matrix: support denied /admin/settings/payments', denied && !/name="[^"]*key/i.test(page.text) ? 'PASS' : 'FAIL', String(page.status));
    const orders = await get('/admin/orders');
    rec(S, 'role matrix: support can open /admin/orders', orders.status === 200 && !/do not have access/i.test(orders.text) ? 'PASS' : 'FAIL', String(orders.status));
    const hidden = ['/admin/analytics', '/admin/analytics/reports', '/admin/analytics/live', '/admin/settings', '/admin/discounts', '/admin/marketing/automations'];
    const navLeak = [];
    for (const h of sidebar(home.text)) for (const x of sidebar((await get(h)).text)) if (hidden.includes(x)) navLeak.push(x);
    for (const h of sidebar(home.text)) if (hidden.includes(h)) navLeak.push(h);
    rec(S, 'role matrix: support sidebar (all sections opened) hides restricted entries', navLeak.length ? 'FAIL' : 'PASS', [...new Set(navLeak)].join(','));
    rec(S, 'role matrix: support home has no revenue KPI cards', /data-widget="orders\.kpi\./.test(home.text) ? 'FAIL' : 'PASS');
    const rep = await get('/admin/analytics/reports/orders.sales-over-time');
    rec(S, 'role matrix: support denied sales report', rep.status === 404 || rep.status >= 400 || /do not have access|forbidden/i.test(rep.text) || renderError(rep.text) ? 'PASS' : 'FAIL', String(rep.status));
    // PII: support never sees a full Indian phone number on the people lists
    const pii = [];
    for (const h of ['/admin/orders', '/admin/customers', '/admin/enquiries']) if (/\+91 ?\d{10}\b/.test((await get(h)).text.replace(/\\u002B/g, '+'))) pii.push(h);
    rec(S, 'role matrix: support sees masked phones', pii.length ? 'FAIL' : 'PASS', pii.join(','));
  }
  // nav: every sidebar entry, and every sub-entry (shown once its section is open), renders for the owner
  const seen = new Set(['/admin']);
  const queue = sidebar(dash.text);
  const navBroken = [];
  while (queue.length) {
    const h = queue.shift();
    if (seen.has(h)) continue;
    seen.add(h);
    const r = await req(h, { admin: true });
    if (r.status !== 200 || renderError(r.text)) navBroken.push(`${h} ${r.status}`);
    for (const x of sidebar(r.text)) if (!seen.has(x)) queue.push(x);
  }
  rec(S, `every nav entry and sub-entry renders (${seen.size})`, seen.size > 10 && !navBroken.length ? 'PASS' : 'FAIL', navBroken.join(' ') || [...seen].join(' ').slice(0, 140));
  // home: KPI strip (sessions, sales, orders, conversion, AOV) and things to do
  const kpis = ['analytics.kpi.sessions', 'orders.kpi.sales', 'orders.kpi.orders', 'analytics.kpi.conversion', 'orders.kpi.aov'].filter((k) => !dash.text.includes(`data-widget="${k}"`));
  rec(S, 'home KPI cards with sparklines', !kpis.length && /data-kpis/.test(dash.text) && !renderError(dash.text) ? 'PASS' : 'FAIL', kpis.length ? `missing ${kpis.join(',')}` : 'all five');
  rec(S, 'home things to do + range compare', /id="things-to-do"/.test(dash.text) && /name="compare"/.test(dash.text) ? 'PASS' : 'FAIL');
  const compared = await req('/admin?from=2026-01-01&to=2026-01-31&compare=previous-year', { admin: true });
  rec(S, 'home with a custom range + previous year', compared.status === 200 && !renderError(compared.text) && compared.text.includes('2025-01-01') ? 'PASS' : 'FAIL', String(compared.status));
  // analytics: overview, live view, and every report page from the reports list
  for (const h of ['/admin/analytics', '/admin/analytics/live']) {
    const r = await req(h, { admin: true });
    rec(S, `analytics ${h}`, r.status === 200 && !renderError(r.text) ? 'PASS' : 'FAIL', String(r.status));
  }
  const list = await req('/admin/analytics/reports', { admin: true });
  const reports = [...new Set(hrefs(list.text).filter((h) => /^\/admin\/analytics\/reports\/[^/?]+/.test(h)))];
  const wanted = ['orders.sales-over-time', 'orders.average-order-value', 'analytics.conversion-funnel', 'analytics.sessions-by-source', 'orders.top-products', 'orders.returning-customers', 'flows.abandoned-checkouts', 'analytics.search-terms'];
  const missing = wanted.filter((id) => !reports.some((h) => h.includes(`/reports/${id}?`)));
  rec(S, `reports list (${reports.length})`, list.status === 200 && !missing.length ? 'PASS' : 'FAIL', missing.length ? `missing ${missing.join(',')}` : '');
  const repBroken = [];
  await pool(reports, 4, async (h) => {
    const r = await req(`${h}${h.includes('?') ? '&' : '?'}compare=previous-period`, { admin: true });
    if (r.status !== 200 || renderError(r.text) || !/<h1/.test(r.text)) repBroken.push(`${h.split('?')[0]} ${r.status}`);
  });
  rec(S, `every report page renders (${reports.length})`, reports.length && !repBroken.length ? 'PASS' : 'FAIL', repBroken.join(' '));
  // index tables: saved-view tabs (and the bulk bar when the list has rows) on the Shopify-style lists
  const idx = ['/admin/orders', '/admin/products', '/admin/customers', '/admin/enquiries', '/admin/discounts', '/admin/abandoned-checkouts', '/admin/reviews'];
  const idxBad = [];
  for (const h of idx) {
    const r = await req(h, { admin: true });
    const rows = /name="ids"/.test(r.text);
    if (r.status !== 200 || renderError(r.text) || !/aria-label="Views"/.test(r.text) || (rows && !/aria-label="Bulk actions"/.test(r.text))) idxBad.push(`${h} ${r.status}`);
  }
  rec(S, `index tables: views + bulk bar (${idx.length})`, idxBad.length ? 'FAIL' : 'PASS', idxBad.join(' '));
  let target = modules.find((m) => m.endsWith('/store'));
  for (const m of target ? [] : modules) if (forms((await req(m, { admin: true })).text).some((f) => /save/i.test(f.text))) { target = m; break; }
  if (target) {
    const before = one(`select updated_at from core_settings where module = '${target.split('/').pop()}' order by updated_at desc limit 1`);
    const s = await submitForm(target, /save/i);
    if (s.skipped) rec(S, `save ${target}`, 'SKIP', s.skipped);
    else {
      const after = one(`select updated_at from core_settings where module = '${target.split('/').pop()}' order by updated_at desc limit 1`);
      rec(S, `save ${target}`, s.res.status < 400 && after && after !== before ? 'PASS' : 'FAIL', `${s.res.status}, updated_at ${before} -> ${after}`);
    }
  }
  // integration keys: a secret saved through the payments form is stored sealed (is_secret, never the plaintext)
  if (modules.includes('/admin/settings/payments')) {
    const plain = `smoke-secret-${randomBytes(6).toString('hex')}`;
    const k = await submitForm('/admin/settings/payments', /save/i, { clientSecret: plain });
    const row = sql(`select is_secret, value::text from core_settings where module = 'payments' and key = 'clientSecret'`)?.[0];
    rec(S, 'save integration key (payments.clientSecret)', k.skipped ? 'SKIP' : k.res.status < 400 && row?.[0] === 't' && !row[1].includes(plain) ? 'PASS' : 'FAIL', k.skipped ?? `${k.res.status}, row=${row ? `secret=${row[0]} plaintext=${row[1].includes(plain)}` : 'none'}`);
  }
  // product: save the first product's edit form unchanged
  const pid = one('select id from catalog_product order by created_at limit 1');
  if (!pid) rec(S, 'save product', 'SKIP', 'no seeded product');
  else {
    const before = one(`select updated_at from catalog_product where id = '${pid}'`);
    const s = await submitForm(`/admin/products/${pid}`, /save/i);
    const after = one(`select updated_at from catalog_product where id = '${pid}'`);
    rec(S, 'save product', s.skipped ? 'SKIP' : s.res.status < 400 && after !== before ? 'PASS' : 'FAIL', s.skipped ?? `${s.res.status}, updated_at ${before} -> ${after}`);
  }
  // price + stock: the first priced variant's pricing form and its inventory count form
  const pv = sql('select p.variant_id, p.product_id, p.price_paise from pricing_price p join inventory_level l using (variant_id) order by p.updated_at limit 1')?.[0];
  if (!pv) rec(S, 'save price / stock', 'SKIP', 'no priced variant with a stock level');
  else {
    const [vid, prodId, paise] = pv;
    const newPrice = ((Number(paise) + 100) / 100).toFixed(2);
    const forms1 = forms((await req(`/admin/products/${prodId}`, { admin: true })).text);
    const post = async (f, overrides) => {
      const fd = new FormData();
      for (const [k, v] of f.fields) fd.append(k, k in overrides ? overrides[k] : v);
      return req(f.action && !f.action.startsWith('javascript') ? f.action : `/admin/products/${prodId}`, { method: 'POST', body: fd, admin: true });
    };
    const pf = forms1.find((f) => f.fields.some(([n, v]) => n === 'variantId' && v === vid) && f.fields.some(([n]) => n === 'price'));
    if (!pf) rec(S, 'save price', 'SKIP', `no pricing form for ${vid} on /admin/products/${prodId}`);
    else {
      const r = await post(pf, { price: newPrice });
      const now = one(`select price_paise from pricing_price where variant_id = '${vid}'`);
      rec(S, 'save price', r.status < 400 && Number(now) === Math.round(Number(newPrice) * 100) ? 'PASS' : 'FAIL', `${r.status}, ${paise} -> ${now}`);
    }
    const sf = forms1.find((f) => f.fields.some(([n, v]) => n === 'variantId' && v === vid) && f.fields.some(([n]) => n === 'onHand'));
    if (!sf) rec(S, 'save stock count', 'SKIP', `no count form for ${vid} on /admin/products/${prodId}`);
    else {
      const r = await post(sf, { onHand: '7', note: 'smoke recount' });
      const now = one(`select on_hand from inventory_level where variant_id = '${vid}'`);
      rec(S, 'save stock count', r.status < 400 && now === '7' ? 'PASS' : 'FAIL', `${r.status}, on_hand=${now}`);
    }
  }
  // discount: create one via /admin/discounts/new
  const code = `SMOKE${Date.now().toString(36).toUpperCase()}`;
  // the rule form (codes are added on the rule's own page after the create redirect)
  const d = await submitForm('/admin/discounts/new', /save|create/i, { name: `Smoke ${code}`, kind: 'automatic', status: 'draft', valueType: 'percent', value: '5', appliesTo: 'order' });
  const dRow = count(`select count(*) from discounts_rule where name = 'Smoke ${code}'`);
  rec(S, 'create discount', d.skipped ? 'SKIP' : dRow > 0 ? 'PASS' : 'FAIL', d.skipped ?? `${d.res.status}${d.res.location ? ' -> ' + d.res.location : ''}, rows=${dRow}`);
  const auditAfter = count('select count(*) from core_audit_log');
  rec(S, 'audit rows written', auditAfter > auditBefore ? 'PASS' : 'FAIL', `${auditBefore} -> ${auditAfter}`);
}

// ---------- run ----------
const up = await req('/api/health/live');
if (up.status === 0) {
  console.error(`smoke: ${BASE} is not reachable (${up.error})`);
  process.exit(2);
}
mintOwnerCookie();
for (const [name, fn] of [['routes', routes], ['money', money], ['jobs', jobs], ['admin', admin]]) {
  if (!ONLY.has(name)) continue;
  try {
    await fn();
  } catch (err) {
    rec(name, 'section crashed', 'FAIL', err.stack?.split('\n').slice(0, 2).join(' | '));
  }
}
const w = Math.min(70, Math.max(...results.map((r) => r.name.length + r.section.length + 3)));
for (const r of results.sort((a, b) => (a.status === 'PASS') - (b.status === 'PASS'))) {
  console.log(`${r.status.padEnd(4)}  ${`${r.section}: ${r.name}`.slice(0, w).padEnd(w)}  ${r.detail}`);
}
const tally = (s) => results.filter((r) => r.status === s).length;
const failed = tally('FAIL') + (STRICT ? tally('SKIP') : 0);
console.log(`\n${tally('PASS')} pass, ${tally('FAIL')} fail, ${tally('SKIP')} skip${STRICT ? ' (strict: skips fail)' : ''}`);
process.exit(failed ? 1 : 0);
