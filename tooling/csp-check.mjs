#!/usr/bin/env node
// Real-browser CSP check (WP-37): loads the storefront, cart, checkout, account, admin and the mock PhonePe round trip
// in Chromium against a running `next start` and fails on any CSP violation, any page that does not hydrate, or an
// island that does not respond. Smoke never runs JS, so this is the check that catches a CSP blocking hydration.
//   node tooling/csp-check.mjs [--base=http://localhost:3371] [--headed]
// env: DATABASE_URL + INTERNAL_SECRET (mint the owner session the way tooling/smoke.mjs does; admin pages skip without them)
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(ROOT, 'apps/shop/package.json'))('@playwright/test');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const BASE = (arg('base', process.env.BASE_URL) ?? 'http://localhost:3371').replace(/\/$/, '');
const DB = process.env.DATABASE_URL;
const SECRET = process.env.INTERNAL_SECRET;

const one = (q) => {
  if (!DB) return null;
  const r = spawnSync('psql', [DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] || null : null;
};

/** Same signed better-auth session cookie as tooling/smoke.mjs mintCookie('owner'). */
function ownerToken() {
  if (!DB || !SECRET) return null;
  const email = 'smoke-owner@example.invalid';
  const token = randomBytes(24).toString('base64url');
  const ok = spawnSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-c', `
    insert into auth_user (id, name, email, email_verified, role, two_factor_enabled, created_at, updated_at)
      values ('${randomUUID()}', 'Smoke owner', '${email}', true, 'owner', true, now(), now())
      on conflict (email) do update set role = 'owner', two_factor_enabled = true, banned = false;
    insert into auth_session (id, token, user_id, expires_at, created_at, updated_at)
      select '${randomUUID()}', '${token}', id, now() + interval '1 day', now(), now() from auth_user where email = '${email}';`]).status === 0;
  if (!ok) return null;
  const secret = createHmac('sha256', SECRET).update('ecomkit:better-auth').digest().toString('base64url');
  return `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`;
}

const results = [];
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });

/** One browsing context (cookies, cart); every page it opens reports CSP violations (event + console). */
async function newContext(cookies = []) {
  const ctx = await browser.newContext({ baseURL: BASE });
  ctx.setDefaultTimeout(30_000);

  if (cookies.length) await ctx.addCookies(cookies.map((c) => ({ ...c, url: BASE })));
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(`${e.effectiveDirective} ${e.blockedURI || 'inline'} ${e.sourceFile ? `(${e.sourceFile.split('/').pop()}:${e.lineNumber})` : ''}`.trim()),
    );
  });
  return { ctx, page: await openPage(ctx) };
}

/** A fresh tab per checked URL (state left by the previous page's island never leaks into the next check). */
async function openPage(ctx) {
  const page = await ctx.newPage();
  page.__console = [];
  page.on('response', (r) => r.request().isNavigationRequest() && r.frame() === page.mainFrame() && r.status() < 300 && (page.__doc = r));
  page.on('console', (m) => /content security policy|refused to (execute|load|apply|connect)/i.test(m.text()) && page.__console.push(m.text().slice(0, 200)));
  // other page errors are reported, not failed: they are not CSP (e.g. a hydration text mismatch)
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message.slice(0, 160)));
  return page;
}

const actionPost = (page, timeout = 10_000) =>
  page.waitForRequest((r) => r.method() === 'POST' && (Boolean(r.headers()['next-action']) || r.url().includes('/api/')), { timeout }).then(
    (r) => `${r.headers()['next-action'] ? 'server action' : 'fetch'} POST ${new URL(r.url()).pathname}`,
    () => null,
  );

/** Hang guard: a browser call that never answers fails the step instead of hanging the run (generous: on a loaded
 * laptop the whole process was seen stalling for ~10 minutes and then carrying on normally). */
const deadline = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: no answer in ${ms / 1000} s`)), ms).unref())]);
const fail = (name, url, e) => void results.push({ name, url, status: '-', policy: '-', scripts: '-', hydrated: false, interaction: `error: ${e.message.split('\n')[0].slice(0, 100)}`, violations: [], errors: [], ok: false });

/** Loads `path` (or checks the page already there), runs `island`, records violations, script nonces, hydration. */
async function check(page, name, path, island) {
  console.error(`... ${name}`);
  if (path) {
    const ctx = page.context();
    await deadline(page.close(), 15_000, 'close tab').catch(() => {});
    page = await openPage(ctx);
  }
  const row = await deadline(checkPage(page, name, path, island), 20 * 60_000, name).catch((e) => fail(name, path ?? page.url().replace(BASE, ''), e));
  if (row) results.push(row);
  return page;
}

async function checkPage(page, name, path, island) {
  try {
    if (path) await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  } catch (e) {
    return fail(name, path, e);
  }
  // hydrated = React has attached to the server HTML (a fiber key on a rendered element); give a slow machine 30 s
  const hydratedFn = () => [...document.querySelectorAll('body *')].slice(0, 400).some((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber$')));
  await page.waitForFunction(hydratedFn, null, { timeout: 30_000, polling: 250 }).catch(() => {});
  const res = page.__doc; // the main-frame document response, also after a redirect or a form post
  await new Promise((r) => setTimeout(r, 1500)); // late islands and violations
  const html = (await Promise.race([res?.text(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => '')) || (await page.content());
  const scripts = (html.match(/<script\b[^>]*>/g) ?? []).length;
  const nonced = (html.match(/<script\b[^>]*\bnonce=/g) ?? []).length;
  const csp = res?.headers()['content-security-policy'] ?? '';
  const hydrated = await page.evaluate(hydratedFn);
  let interaction = 'n/a';
  try {
    interaction = island ? ((await island(page)) ?? 'no response') : 'n/a';
  } catch (e) {
    interaction = `error: ${e.message.split('\n')[0].slice(0, 100)}`;
  }
  const violations = [...new Set([...(await page.evaluate(() => window.__csp ?? []).catch(() => [])), ...page.__console])];
  const errors = page.__errors.splice(0);
  page.__console.length = 0;
  await page.evaluate(() => (window.__csp = [])).catch(() => {});
  const ok = violations.length === 0 && hydrated && interaction !== 'no response' && !interaction.startsWith('error');
  const policy = /script-src ([^;]*)/.exec(csp)?.[1] ?? '(none)';
  return { name, url: page.url().replace(BASE, ''), status: res?.status() ?? '-', policy, scripts: `${nonced}/${scripts}`, hydrated, interaction, violations, errors, ok };
}

const openAssistant = async (page) => {
  await page.click('[data-cta="assistant-open"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  return 'assistant drawer opened';
};
const clickAndPost = (cta, label) => async (page) => {
  const posted = actionPost(page);
  await page.locator(`[data-cta="${cta}"]`).first().click();
  return posted.then((r) => r && `${label}: ${r}`);
};

// ---------- storefront (guest) ----------
// same purchasable variant rule as tooling/smoke.mjs (price + free stock, not a made-to-order item)
const [variantId, slug] = (one(`select v.id || ' ' || p.slug from catalog_variant v join catalog_product p on p.id = v.product_id and p.status = 'active' and p.deleted_at is null and p.kind = 'plant'
  join pricing_price pp on pp.variant_id = v.id join inventory_level l on l.variant_id = v.id
  where l.on_hand - l.reserved >= 20 and l.ready_in_days is null order by l.on_hand desc limit 1`) ?? '').split(' ');
{
  let { ctx, page } = await newContext();
  page = await check(page, 'home', '/', clickAndPost('consent-accept', 'consent accept'));
  page = await check(page, 'plants', '/plants', clickAndPost('card-add-to-cart', 'add to cart'));
  page = await check(page, 'product', slug ? `/plant/${slug}` : '/plants', openAssistant);
  page = await check(page, 'cart', '/cart', openAssistant);
  await deadline(ctx.close(), 15_000, 'close').catch(() => {});
}

// ---------- money path (guest): a cart holding one purchasable plant -> checkout -> mock PhonePe -> return ----------
{
  let { ctx, page } = await newContext();
  if (variantId) await ctx.request.post('/api/cart/lines', { data: { variantId, delta: 2 }, headers: { origin: BASE } });
  page = await check(page, 'checkout', '/checkout', async (p) => {
    const phone = p.locator('input[name="phone"]');
    await phone.fill('9876543210');
    await p.fill('input[name="name"]', 'CSP Check');
    const posted = actionPost(p);
    await p.fill('input[name="email"]', 'csp-check@example.invalid');
    await p.locator('input[name="email"]').blur();
    const saved = await posted;
    return saved ? `contact autosave: ${saved}` : null;
  });
  // place an order paid online: checkout -> mock PhonePe pay page (static CSP, no scripts) -> return page
  let placed = false;
  console.error('... place order');
  await deadline((async () => {
    // Bengaluru local delivery, as in tooling/smoke.mjs; the pincode autofills district and state, then the first available method
    await page.fill('input[name="pincode"]', '560060');
    await page.fill('input[name="line1"]', '1 Test Road');
    await page.fill('input[name="villageTown"]', 'Kengeri');
    await page.locator('input[name="methodId"]:not([disabled])').first().check();
    const online = page.locator('[data-cta="checkout-pay-online"]');
    if (await online.count()) await online.first().check();
    await page.locator('[data-cta="checkout-policy-ack"]').check();
    await Promise.all([page.waitForURL(/_mock\/phonepe\/paypage/, { timeout: 30_000 }), page.click('[data-cta="checkout-pay"]')]);
    placed = true;
  })(), 20 * 60_000, 'place order').catch((e) => fail('place order', page.url().replace(BASE, ''), e));
  if (placed) {
    // plain HTML form under the static CSP, no scripts and nothing to hydrate: only violations are checked
    console.error('... mock PhonePe pay page');
    const csp = page.__doc?.headers()['content-security-policy'] ?? '';
    const violations = [...(await page.evaluate(() => window.__csp ?? []).catch(() => [])), ...page.__console.splice(0)];
    results.push({ name: 'mock PhonePe pay page', url: page.url().replace(BASE, ''), status: page.__doc?.status() ?? '-', policy: /script-src ([^;]*)/.exec(csp)?.[1] ?? '(none)', scripts: '0/0', hydrated: 'n/a', interaction: 'n/a', violations, errors: [], ok: violations.length === 0 });
    const paid = await Promise.all([page.waitForURL((u) => !u.pathname.includes('_mock'), { timeout: 30_000 }), page.locator('button[value="success"], input[value="success"]').first().click()]).then(
      () => true,
      (e) => fail('pay return', page.url().replace(BASE, ''), e),
    );
    if (paid) await check(page, 'pay return', null, null);
  }
  await deadline(ctx.close(), 15_000, 'close').catch(() => {});
}

// ---------- account + admin sign-in (signed out) ----------
{
  let { ctx, page } = await newContext();
  page = await check(page, 'account login', '/account/login', async (p) => {
    await p.fill('input[name="identifier"]', '9876500000');
    const posted = actionPost(p);
    await p.click('[data-cta="account-login-send-code"]');
    return posted.then((r) => r && `send code: ${r}`);
  });
  page = await check(page, 'admin login', '/admin/login', async (p) => {
    const email = p.locator('input[type="email"], input[name="email"]').first();
    await email.fill('nobody@example.invalid');
    await p.locator('input[type="password"]').first().fill('not-the-password');
    const posted = actionPost(p);
    await p.click('[data-cta="staff-login-submit"]');
    return posted.then((r) => r && `sign in: ${r}`);
  });
  await deadline(ctx.close(), 15_000, 'close').catch(() => {});
}

// ---------- admin as owner ----------
const token = ownerToken();
if (!token) fail('admin (owner)', '-', new Error('SKIP: no DATABASE_URL / INTERNAL_SECRET'));
else {
  let { ctx, page } = await newContext([{ name: 'ek.session_token', value: encodeURIComponent(token) }]);
  // Ctrl+K search when a module offers admin search (the box is hidden otherwise), else a sidebar link: a hydrated
  // shell navigates client-side (an RSC fetch), a dead one reloads the whole document.
  const adminIsland = (cta) => async (p) => {
    if (await p.locator('[aria-label="Search the admin"]').count()) {
      await p.keyboard.press('Control+k');
      if ((await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) !== 'Search the admin') return null;
      const posted = actionPost(p);
      await p.keyboard.type('ma');
      return posted.then((r) => r && `Ctrl+K search: ${r}`);
    }
    const rsc = p.waitForRequest((r) => Boolean(r.headers().rsc) && !r.isNavigationRequest(), { timeout: 10_000 }).catch(() => null);
    await p.locator(`[data-cta="${cta}"]`).first().click();
    const r = await rsc;
    return r && `sidebar link: client navigation (RSC ${new URL(r.url()).pathname})`;
  };
  page = await check(page, 'admin home (owner)', '/admin', adminIsland('admin-nav-orders'));
  page = await check(page, 'admin orders (owner)', '/admin/orders', adminIsland('admin-nav-home'));
  // a [param] route too: its build entry is a fallback shell, the layout must still make it render per request
  const orderId = one('select id from orders_order order by created_at desc limit 1');
  if (orderId) page = await check(page, 'admin order detail (owner)', `/admin/orders/${orderId}`, adminIsland('admin-nav-orders'));
  await deadline(ctx.close(), 15_000, 'close').catch(() => {});
}

await deadline(browser.close(), 15_000, "close").catch(() => {});

console.log(`\nCSP check against ${BASE}\n`);
console.log('| page | url | status | script-src | nonced/scripts | hydrated | island | CSP violations | result |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results)
  console.log(`| ${r.name} | ${r.url} | ${r.status} | \`${r.policy}\` | ${r.scripts} | ${r.hydrated === 'n/a' ? 'n/a' : r.hydrated ? 'yes' : 'NO'} | ${r.interaction} | ${r.violations.length} | ${r.ok ? 'PASS' : 'FAIL'} |`);
for (const r of results.filter((x) => x.violations.length)) console.log(`\n${r.name}:\n  ${r.violations.slice(0, 8).join('\n  ')}${r.violations.length > 8 ? `\n  ... ${r.violations.length - 8} more` : ''}`);
for (const r of results.filter((x) => x.errors?.length)) console.log(`\n${r.name} (page errors, not CSP):\n  ${[...new Set(r.errors)].join('\n  ')}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
