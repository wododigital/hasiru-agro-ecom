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
      headers: { origin: BASE, cookie: cookieHeader(admin ? OWNER_COOKIE : ''), 'user-agent': 'ecomkit-smoke', ...headers },
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

async function money() {
  const S = 'money';
  const missing = ['cart_cart', 'orders_order', 'payments_attempt'].filter((t) => DB && !tableExists(t));
  if (missing.length) return rec(S, 'money path', 'SKIP', `tables missing (modules not enabled in modules.config): ${missing.join(', ')}`);
  const cartApi = await req('/api/cart');
  if (cartApi.status === 404) return rec(S, 'money path', 'SKIP', '/api/cart not assembled');
  const variant = sql(`select v.id from catalog_variant v join catalog_product p on p.id = v.product_id
    left join inventory_level l on l.variant_id = v.id where coalesce(l.on_hand, 1) > 1 limit 1`)?.[0]?.[0];
  if (!variant) return rec(S, 'money path', 'SKIP', 'no seeded purchasable variant');
  const stockBefore = count(`select coalesce(sum(on_hand),0) from inventory_level where variant_id = '${variant}'`);

  const add = await req('/api/cart/lines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, delta: 1 }) });
  rec(S, 'add to cart', add.status === 200 && json(add)?.qty >= 1 ? 'PASS' : 'FAIL', `${add.status} ${add.text.slice(0, 80)}`);
  const quote = await req('/api/cart');
  const q = json(quote);
  rec(S, 'cart quote', quote.status === 200 && q ? 'PASS' : 'FAIL', `${quote.status} ${quote.text.slice(0, 100)}`);

  const since = one('select now()');
  const placed = await submitForm('/checkout', /place order|pay now|\$ACTION_ID/i, {
    name: 'Smoke Buyer', phone: '9876543210', email: 'smoke-buyer@example.invalid', line1: '1 Test Road', pincode: '560001', city: 'Bengaluru', consent: 'on',
  }, { admin: false });
  if (placed.skipped) return rec(S, 'place order', 'SKIP', placed.skipped);
  const order = sql(`select id, status from orders_order where created_at >= '${since}' order by created_at desc limit 1`)?.[0];
  rec(S, 'place order', order ? 'PASS' : 'FAIL', order ? `order ${order[0]} ${order[1]}` : `POST /checkout -> ${placed.res.status} ${placed.res.location ?? ''}`);
  if (!order) return;
  const attempt = sql(`select merchant_order_id, amount_paise from payments_attempt where order_id = '${order[0]}' order by attempt_no desc limit 1`)?.[0];
  if (!attempt) return rec(S, 'payment attempt', 'FAIL', 'no payments_attempt row');
  if (!SECRET) return rec(S, 'signed webhook', 'SKIP', 'INTERNAL_SECRET not set');
  const pw = createHmac('sha256', SECRET).update('ecomkit:payments-mock-webhook').digest().toString('hex');
  const auth = createHash('sha256').update(`mock:${pw}`).digest('hex');
  const body = JSON.stringify({
    event: 'checkout.order.completed',
    payload: { merchantOrderId: attempt[0], orderId: `MOCK-${attempt[0]}`, state: 'COMPLETED', amount: Number(attempt[1]), paymentDetails: [{ transactionId: `T${Date.now()}`, paymentMode: 'UPI_INTENT', state: 'COMPLETED', amount: Number(attempt[1]), timestamp: Date.now() }] },
  });
  const wh = await req('/api/webhooks/phonepe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body });
  rec(S, 'signed mock webhook', wh.status < 300 ? 'PASS' : 'FAIL', String(wh.status));
  // the webhook is processed by a job: give the worker a moment
  let status = '';
  for (let i = 0; i < 20 && !['paid', 'confirmed'].includes(status); i++) {
    status = one(`select status from orders_order where id = '${order[0]}'`) ?? '';
    if (!['paid', 'confirmed'].includes(status)) await new Promise((r) => setTimeout(r, 500));
  }
  rec(S, 'order paid', ['paid', 'confirmed'].includes(status) ? 'PASS' : 'FAIL', status || 'no row (is the worker running?)');
  const stockAfter = count(`select coalesce(sum(on_hand),0) from inventory_level where variant_id = '${variant}'`);
  rec(S, 'stock committed', stockAfter < stockBefore ? 'PASS' : 'FAIL', `${stockBefore} -> ${stockAfter}`);
  rec(S, 'invoice issued', count(`select count(*) from orders_invoice where order_id = '${order[0]}'`) > 0 ? 'PASS' : 'FAIL');
  const msgs = sql(`select channel, count(*) from notifications_message where created_at >= '${since}' group by 1`) ?? [];
  for (const ch of ['email', 'whatsapp']) rec(S, `notification queued (${ch})`, msgs.some(([c]) => c === ch) ? 'PASS' : 'FAIL', JSON.stringify(msgs));
  const ev = sql(`select name from analytics_event where occurred_at >= '${since}' group by 1`) ?? [];
  rec(S, 'analytics events', ev.length ? 'PASS' : 'FAIL', ev.map((e) => e[0]).join(',') || 'none');
}

async function jobs() {
  const S = 'jobs';
  const since = one('select now()');
  // abandoned cart: cart.abandoned -> flow run -> reminder queued (needs the worker; the sweep runs on its schedule)
  if (DB && !tableExists('flows_run')) rec(S, 'abandoned cart flow', 'SKIP', 'flows tables missing (module not enabled)');
  else if (DB && tableExists('cart_cart')) {
    const n = count(`select count(*) from flows_run r join flows_flow f on f.id = r.flow_id where f.key = 'cart_abandoned'`);
    rec(S, 'abandoned cart flow runs', n > 0 ? 'PASS' : 'SKIP', `${n} runs (needs consented cart + worker sweep; clock not advanced by smoke)`);
  }
  // notify-me
  // notify-me only accepts a variant that has an inventory level row
  const variant = one('select variant_id from inventory_level limit 1');
  if (!variant) rec(S, 'notify-me', 'SKIP', 'no inventory_level rows (seed data)');
  else {
    const r = await req('/api/notify-me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variantId: variant, channel: 'email', email: 'smoke-notify@example.invalid', consent: true }) });
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
  // ERP sync against the mock + feed regeneration: admin action buttons (server-action forms)
  for (const [name, page, match, table] of [
    ['ERP sync now (mock)', '/admin/settings/erp-sync', /sync stock now/i, 'erp_sync_run'],
    ['feed regeneration', '/admin/settings/feeds', /rebuild feeds now/i, 'feeds_run'],
  ]) {
    if (DB && !tableExists(table)) {
      rec(S, name, 'SKIP', `${table} missing (module not enabled)`);
      continue;
    }
    const before = count(`select count(*) from ${table}`);
    const s = await submitForm(page, match);
    if (s.skipped) {
      rec(S, name, 'SKIP', s.skipped);
      continue;
    }
    await new Promise((r) => setTimeout(r, 1500));
    const after = count(`select count(*) from ${table}`);
    rec(S, name, s.res.status < 500 && after > before ? 'PASS' : 'FAIL', `POST ${s.res.status}, ${table} ${before} -> ${after}`);
  }
  if (DB && tableExists('feeds_file')) {
    const token = one(`select value->>'token' from core_settings where module = 'feeds' limit 1`);
    const r = await req(`/feeds/google.xml${token ? `?token=${token}` : ''}`);
    rec(S, 'google feed served', r.status === 200 ? 'PASS' : r.status >= 500 ? 'FAIL' : 'SKIP', String(r.status));
  }
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
