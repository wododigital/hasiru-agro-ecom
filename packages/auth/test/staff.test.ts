import { readFileSync } from 'node:fs';
import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import { PERMISSIONS, STAFF_ROLES, type OutboundMessage, type StaffRole } from '@ecomkit/core/contracts';
import type { TestDb } from '@ecomkit/core/testing';
import { getAuthTables } from 'better-auth/db';
import { getTableColumns } from 'drizzle-orm';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authAccount, authRolePermission, authSession, authUser, authVerification } from '../src/schema';
import { authOptions, authTables } from '../src/server/auth';
import { storePhoneCode } from '../src/server/codes';
import { verifyOtp } from '../src/server/otp';
import {
  acceptInvite,
  beginTotpEnrolment,
  bootstrapOwner,
  confirmTotpEnrolment,
  ensureRolePermissions,
  getRoleMatrix,
  inviteStaff,
  listStaff,
  resendInvite,
  setRolePermissions,
  setStaffDisabled,
  setStaffRole,
  signInStaff,
  signOut,
  verifyStaffSecondFactor,
} from '../src/server/staff';
import { requireOwner, requirePermission, requireStaff, resolveViewer, staffGate } from '../src/server/viewer';
import { authContext } from '../src/server/viewer';
import { Jar, setupAuthDb, totp, varOf } from './helpers';

let t: TestDb;
let sent: OutboundMessage[];
let as: (jar: Jar | null) => void;
let ipSeq = 0;
const freshIp = () => `192.0.2.${++ipSeq}`;
const PASSWORD = 'correct horse battery';

beforeAll(async () => {
  ({ t, sent, as } = await setupAuthDb('wp-02-staff'));
  await ensureRolePermissions();
});

afterAll(async () => {
  await t?.close();
});

const inviteToken = () => new URL(varOf(sent.at(-1), 'link')).searchParams.get('invite')!;

/** Invite link -> password -> sign-in -> authenticator enrolment. Returns a signed-in jar and the 2FA material. */
async function onboard(email: string, role: StaffRole, owner: Jar | null) {
  if (owner) {
    as(owner);
    await inviteStaff({ email, name: role, role });
  } else {
    await bootstrapOwner({ email, name: 'Owner' });
  }
  expect(sent.at(-1)).toMatchObject({ templateKey: 'staff.invite', to: email });
  expect(await acceptInvite({ token: inviteToken(), password: PASSWORD })).toEqual({ status: 'ok' });
  const jar = new Jar(freshIp());
  const signIn = await signInStaff({ email, password: PASSWORD, ip: jar.ip, requestHeaders: jar.headers() });
  expect(signIn.status).toBe('enrol');
  if (signIn.status !== 'enrol') throw new Error('unexpected');
  jar.apply(signIn.headers);
  const enrol = await beginTotpEnrolment({ password: PASSWORD, requestHeaders: jar.headers() });
  if (enrol.status !== 'ok') throw new Error('enrolment failed');
  jar.apply(enrol.headers);
  const confirmed = await confirmTotpEnrolment({ code: totp(enrol.secret), requestHeaders: jar.headers() });
  expect(confirmed.status).toBe('ok');
  if (confirmed.status === 'ok') jar.apply(confirmed.headers);
  return { jar, secret: enrol.secret, backupCodes: enrol.backupCodes };
}

/** Parses the role matrix table in docs/CONVENTIONS.md section 10 (the frozen catalogue). */
function conventionsMatrix(): Record<StaffRole, string[]> {
  const doc = readFileSync(new URL('../../../docs/CONVENTIONS.md', import.meta.url), 'utf8');
  const out = Object.fromEntries(STAFF_ROLES.map((r) => [r, [] as string[]])) as Record<StaffRole, string[]>;
  const header = doc.split('\n').find((l) => l.startsWith('| Permission | owner'))!;
  const roles = header.split('|').slice(2, -1).map((s) => s.trim()) as StaffRole[];
  for (const line of doc.split('\n')) {
    const cells = line.split('|').map((s) => s.trim());
    if (!/^[a-z]+\.[a-z]+$/.test(cells[1] ?? '')) continue;
    roles.forEach((role, i) => {
      if (cells[i + 2] === 'x') out[role].push(cells[1]!);
    });
  }
  return out;
}

let owner: Awaited<ReturnType<typeof onboard>>;

describe('owner bootstrap, invite and authenticator enrolment', () => {
  it('bootstraps the first owner once, through an invite link', async () => {
    owner = await onboard('owner@example.com', 'owner', null);
    await expect(bootstrapOwner({ email: 'second@example.com', name: 'X' })).rejects.toThrow(/owner already exists/);
  });

  it('an invite link works once, expires, and needs a 12+ character password', async () => {
    as(owner.jar);
    await inviteStaff({ email: 'late@example.com', name: 'Late', role: 'support' });
    const token = inviteToken();
    expect(await acceptInvite({ token, password: 'short' })).toEqual({ status: 'invalid' });
    expect(await acceptInvite({ token: 'x'.repeat(43), password: PASSWORD })).toEqual({ status: 'invalid' });
    await t.db.update(authVerification).set({ expiresAt: new Date(Date.now() - 1) }).where(sql`${authVerification.identifier} like 'staff-invite:%'`);
    expect(await acceptInvite({ token, password: PASSWORD })).toEqual({ status: 'invalid' });
  });

  it('2FA gate: a password-only staff session has no permissions until the authenticator is confirmed', async () => {
    as(owner.jar);
    await inviteStaff({ email: 'gate@example.com', name: 'Gate', role: 'manager' });
    await acceptInvite({ token: inviteToken(), password: PASSWORD });
    const jar = new Jar(freshIp());
    const signIn = await signInStaff({ email: 'gate@example.com', password: PASSWORD, ip: jar.ip, requestHeaders: jar.headers() });
    if (signIn.status !== 'enrol') throw new Error(signIn.status);
    jar.apply(signIn.headers);
    expect(await resolveViewer(jar.headers())).toEqual({ kind: 'guest' });
    expect(await staffGate(jar.headers())).toEqual({ state: 'enrol', email: 'gate@example.com' });
    as(jar);
    await expect(requirePermission('orders.read')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireStaff()).rejects.toBeInstanceOf(NotFoundError);

    expect((await beginTotpEnrolment({ password: 'wrong password!!', requestHeaders: jar.headers() })).status).toBe('invalid');
    const enrol = await beginTotpEnrolment({ password: PASSWORD, requestHeaders: jar.headers() });
    if (enrol.status !== 'ok') throw new Error('enrol');
    jar.apply(enrol.headers);
    expect(enrol.backupCodes).toHaveLength(10);
    expect(enrol.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect((await confirmTotpEnrolment({ code: '000000', requestHeaders: jar.headers() })).status).toBe('invalid');
    expect(await resolveViewer(jar.headers())).toEqual({ kind: 'guest' });
    const ok = await confirmTotpEnrolment({ code: totp(enrol.secret), requestHeaders: jar.headers() });
    if (ok.status !== 'ok') throw new Error('confirm');
    jar.apply(ok.headers);
    expect(await resolveViewer(jar.headers())).toMatchObject({ kind: 'staff', role: 'manager' });
    expect((await staffGate(jar.headers())).state).toBe('ready');
  });

  it('enrolled staff need the authenticator code (or a single-use backup code) after the password', async () => {
    const jar = new Jar(freshIp());
    const first = await signInStaff({ email: 'owner@example.com', password: PASSWORD, ip: jar.ip, requestHeaders: jar.headers() });
    if (first.status !== 'two_factor') throw new Error(first.status);
    jar.apply(first.headers);
    expect(await resolveViewer(jar.headers())).toEqual({ kind: 'guest' });
    expect((await verifyStaffSecondFactor({ code: '000000', method: 'totp', requestHeaders: jar.headers() })).status).toBe('invalid');
    const ok = await verifyStaffSecondFactor({ code: totp(owner.secret), method: 'totp', requestHeaders: jar.headers() });
    if (ok.status !== 'ok') throw new Error('totp');
    jar.apply(ok.headers);
    expect(await resolveViewer(jar.headers())).toMatchObject({ kind: 'staff', role: 'owner' });

    const backup = owner.backupCodes[0]!;
    for (const expected of ['ok', 'invalid'] as const) {
      const j = new Jar(freshIp());
      const s = await signInStaff({ email: 'owner@example.com', password: PASSWORD, ip: j.ip, requestHeaders: j.headers() });
      if (s.status !== 'two_factor') throw new Error(s.status);
      j.apply(s.headers);
      expect((await verifyStaffSecondFactor({ code: backup, method: 'backup', requestHeaders: j.headers() })).status).toBe(expected);
    }
  });

  it('sign-out ends the session', async () => {
    const { jar } = owner;
    const j = new Jar(freshIp());
    const s = await signInStaff({ email: 'owner@example.com', password: PASSWORD, ip: j.ip, requestHeaders: j.headers() });
    if (s.status !== 'two_factor') throw new Error(s.status);
    j.apply(s.headers);
    const v = await verifyStaffSecondFactor({ code: totp(owner.secret), method: 'totp', requestHeaders: j.headers() });
    if (v.status !== 'ok') throw new Error('totp');
    j.apply(v.headers);
    j.apply(await signOut(j.headers()));
    expect(await resolveViewer(j.headers())).toEqual({ kind: 'guest' });
    expect((await resolveViewer(jar.headers())).kind).toBe('staff');
  });
});

describe('lockout and limits', () => {
  it('locks an email for 15 minutes after 5 failures, even with the right password, then lets it in', async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await signInStaff({ email: 'owner@example.com', password: 'wrong password!', ip: freshIp(), requestHeaders: new Headers() })).status);
    expect(statuses).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
    const locked = await signInStaff({ email: 'owner@example.com', password: PASSWORD, ip: freshIp(), requestHeaders: new Headers() });
    expect(locked.status).toBe('locked');
    if (locked.status === 'locked') expect(locked.retryAfterSec).toBeGreaterThan(890);
    const later = await signInStaff({ email: 'owner@example.com', password: PASSWORD, ip: freshIp(), requestHeaders: new Headers(), now: new Date(Date.now() + 901_000) });
    expect(later.status).toBe('two_factor');
  });

  it('locks unknown emails the same way, so a lock reveals nothing', async () => {
    for (let i = 0; i < 5; i++) await signInStaff({ email: 'nobody@example.com', password: 'whatever pass', ip: freshIp(), requestHeaders: new Headers() });
    expect((await signInStaff({ email: 'nobody@example.com', password: 'whatever pass', ip: freshIp(), requestHeaders: new Headers() })).status).toBe('locked');
  });

  it('allows 10 password attempts per IP per 15 minutes', async () => {
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await signInStaff({ email: `ip${i}@example.com`, password: 'nope nope nope', ip, requestHeaders: new Headers() })).status);
    expect(statuses.slice(0, 10).every((s) => s === 'invalid')).toBe(true);
    expect(statuses[10]).toBe('rate_limited');
  });

  it('customers have no password sign-in', async () => {
    await t.db.insert(authUser).values({ email: 'shopper@example.com', name: 'Shopper' });
    expect((await signInStaff({ email: 'shopper@example.com', password: PASSWORD, ip: freshIp(), requestHeaders: new Headers() })).status).toBe('invalid');
  });
});

describe('session lifetimes', () => {
  it('staff sessions are created with a 12 h expiry and end 12 h after sign-in however active', async () => {
    const { jar } = await onboard('lifetime@example.com', 'support', owner.jar);
    const [user] = await t.db.select().from(authUser).where(eq(authUser.email, 'lifetime@example.com'));
    const sessions = await t.db.select().from(authSession).where(eq(authSession.userId, user!.id));
    const latest = sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
    expect(latest.expiresAt.getTime() - latest.createdAt.getTime()).toBeLessThanOrEqual(12 * 3600_000 + 5_000);

    await t.db.update(authSession).set({ createdAt: new Date(Date.now() - 11.9 * 3600_000) }).where(eq(authSession.userId, user!.id));
    expect((await resolveViewer(jar.headers())).kind).toBe('staff');
    await t.db.update(authSession).set({ createdAt: new Date(Date.now() - 12 * 3600_000 - 1000) }).where(eq(authSession.userId, user!.id));
    expect(await resolveViewer(jar.headers())).toEqual({ kind: 'guest' });
    expect(await t.db.select().from(authSession).where(eq(authSession.userId, user!.id))).toHaveLength(0);
  });

  it('customer sessions last 30 days', async () => {
    await storePhoneCode('+919812300001', '135790');
    const jar = new Jar(freshIp());
    const r = await verifyOtp({ identifier: '9812300001', code: '135790', requestHeaders: jar.headers() });
    if (r.status !== 'ok') throw new Error('customer sign-in');
    const [s] = await t.db.select().from(authSession).where(eq(authSession.userId, r.userId));
    expect(Math.round((s!.expiresAt.getTime() - s!.createdAt.getTime()) / 86_400_000)).toBe(30);
  });
});

describe('role matrix', () => {
  const jars = {} as Record<StaffRole, Jar>;

  beforeAll(async () => {
    jars.owner = owner.jar;
    for (const role of STAFF_ROLES.filter((r) => r !== 'owner')) jars[role] = (await onboard(`${role}@example.com`, role, owner.jar)).jar;
  });

  it('the default matrix matches the CONVENTIONS permission table exactly', async () => {
    const expected = conventionsMatrix();
    for (const role of STAFF_ROLES) {
      const viewer = await resolveViewer(jars[role].headers());
      if (viewer.kind !== 'staff') throw new Error(`${role} is not staff`);
      expect([...viewer.permissions].sort(), role).toEqual([...expected[role]].sort());
    }
    expect([...expected.owner].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('every stored permission string is in the frozen catalogue', async () => {
    const rows = await t.db.select().from(authRolePermission);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(PERMISSIONS).toContain(r.permission);
  });

  it('requirePermission allows exactly the matrix, per role', async () => {
    const expected = conventionsMatrix();
    for (const role of STAFF_ROLES) {
      as(jars[role]);
      for (const p of PERMISSIONS) {
        if (expected[role].includes(p)) await expect(requirePermission(p)).resolves.toMatchObject({ role });
        else await expect(requirePermission(p), `${role} ${p}`).rejects.toBeInstanceOf(ForbiddenError);
      }
    }
  });

  it('an edited role takes effect on the next request; owner is fixed', async () => {
    as(owner.jar);
    await setRolePermissions('support', ['orders.read', 'customers.read']);
    expect(await resolveViewer(jars.support.headers())).toMatchObject({ permissions: ['orders.read', 'customers.read'] });
    expect((await getRoleMatrix()).owner).toEqual([...PERMISSIONS]);
    await expect(setRolePermissions('owner', [])).rejects.toThrow(/fixed/);
    await expect(setRolePermissions('support', ['orders.read', 'orders.delete'])).rejects.toThrow(/unknown/);
    // A second seed leaves edited roles alone and inserts nothing.
    expect(await ensureRolePermissions()).toBe(0);
    expect(await resolveViewer(jars.support.headers())).toMatchObject({ permissions: ['orders.read', 'customers.read'] });
  });

  it('only staff.manage can manage staff, and the last owner is protected', async () => {
    as(jars.manager);
    await expect(inviteStaff({ email: 'x@example.com', name: 'X', role: 'owner' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listStaff()).rejects.toBeInstanceOf(ForbiddenError);
    as(owner.jar);
    const staff = await listStaff();
    expect(staff.find((s) => s.email === 'owner@example.com')).toMatchObject({ role: 'owner', twoFactorEnabled: true, invitePending: false });
    expect(staff.find((s) => s.email === 'late@example.com')).toMatchObject({ invitePending: true });
    const ownerId = staff.find((s) => s.email === 'owner@example.com')!.id;
    await expect(setStaffRole(ownerId, 'manager')).rejects.toThrow(/own role/);
    await expect(setStaffDisabled(ownerId, true)).rejects.toThrow(/yourself/);
  });

  it('non-owners cannot escalate to or act on owners; invites cannot reset active accounts', async () => {
    as(owner.jar);
    const staff = await listStaff();
    const ownerId = staff.find((s) => s.email === 'owner@example.com')!.id;
    const managerId = staff.find((s) => s.email === 'manager@example.com')!.id;
    const pendingId = staff.find((s) => s.email === 'late@example.com')!.id;
    await expect(inviteStaff({ email: 'manager@example.com', name: 'M', role: 'owner' })).rejects.toThrow(/already a staff member/);
    await expect(resendInvite(managerId)).rejects.toThrow(/already accepted/);
    expect((await resendInvite(pendingId)).link).toContain('invite=');
    const before = (await getRoleMatrix()).manager;
    await setRolePermissions('manager', [...before, 'staff.manage']);
    try {
      as(jars.manager);
      await expect(inviteStaff({ email: 'boss@example.com', name: 'B', role: 'owner' })).rejects.toThrow(/only an owner/);
      await expect(resendInvite(ownerId)).rejects.toThrow(/only an owner/);
      await expect(setStaffDisabled(ownerId, true)).rejects.toThrow(/only an owner/);
    } finally {
      as(owner.jar);
      await setRolePermissions('manager', before);
    }
  });

  it('a disabled staff member is signed out everywhere and cannot sign in', async () => {
    as(owner.jar);
    const [target] = await t.db.select().from(authUser).where(eq(authUser.email, 'fulfilment@example.com'));
    await setStaffDisabled(target!.id, true);
    expect(await resolveViewer(jars.fulfilment.headers())).toEqual({ kind: 'guest' });
    expect((await signInStaff({ email: 'fulfilment@example.com', password: PASSWORD, ip: freshIp(), requestHeaders: new Headers() })).status).toBe('invalid');
    await setStaffDisabled(target!.id, false);
    expect((await signInStaff({ email: 'fulfilment@example.com', password: PASSWORD, ip: freshIp(), requestHeaders: new Headers() })).status).toBe('two_factor');
  });

  it('role changes apply immediately and are audited', async () => {
    as(owner.jar);
    const [target] = await t.db.select().from(authUser).where(eq(authUser.email, 'catalog_editor@example.com'));
    await setStaffRole(target!.id, 'support');
    expect(await resolveViewer(jars.catalog_editor.headers())).toMatchObject({ role: 'support' });
    const { rows } = await t.db.execute<{ action: string }>(sql`select action from core_audit_log where entity_id = ${target!.id} order by created_at`);
    expect(rows.map((r) => r.action)).toEqual(['staff.invite', 'staff.accept-invite', 'staff.role']);
  });
});

describe('customers and ownership', () => {
  it('requireOwner admits only the owning customer; staff checks reject customers', async () => {
    const customers = [];
    for (const n of ['9812300011', '9812300012']) {
      await storePhoneCode(`+91${n}`, '246810');
      const jar = new Jar(freshIp());
      const r = await verifyOtp({ identifier: n, code: '246810', requestHeaders: jar.headers() });
      if (r.status !== 'ok') throw new Error('sign-in');
      customers.push({ jar: jar.apply(r.headers), id: r.userId });
    }
    const [a, b] = customers as [(typeof customers)[number], (typeof customers)[number]];
    as(a.jar);
    await expect(requireOwner(a.id)).resolves.toMatchObject({ customerId: a.id });
    await expect(requireOwner(b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requirePermission('orders.read')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireStaff()).rejects.toBeInstanceOf(NotFoundError);
    await expect(authContext.getViewer()).resolves.toMatchObject({ kind: 'customer', customerId: a.id });
    as(null);
    await expect(requireOwner(a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('HTTP surface', () => {
  it('only session read and sign-out are reachable at /api/auth', async () => {
    const { GET, POST } = await import('../src/routes/auth-handler');
    const url = (p: string) => `http://localhost:3000/api/auth${p}`;
    expect((await GET(new Request(url('/get-session'), { headers: owner.jar.headers() }))).status).toBe(200);
    const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify(body) });
    for (const path of ['/sign-up/email', '/sign-in/email', '/phone-number/send-otp', '/phone-number/verify', '/email-otp/send-verification-otp', '/admin/list-users', '/admin/set-role', '/two-factor/enable']) {
      expect((await POST(new Request(url(path), json({ email: 'a@example.com', password: PASSWORD, name: 'A' })))).status, path).toBe(404);
    }
    expect(await t.db.select().from(authUser).where(eq(authUser.email, 'a@example.com'))).toHaveLength(0);
  });
});

describe('schema', () => {
  it('every field Better Auth writes for this plugin set has a column (auth generate drift check)', () => {
    const tables = getAuthTables(authOptions());
    for (const [model, def] of Object.entries(tables)) {
      if (model === 'rateLimit') continue; // rate limiting is off; core_rate_limit is the limiter
      const table = authTables[model as keyof typeof authTables];
      expect(table, `missing table for ${model}`).toBeDefined();
      const columns = Object.keys(getTableColumns(table));
      for (const field of Object.keys(def.fields)) expect(columns, `${model}.${field}`).toContain(field);
    }
  });

  it('stores password hashes, never passwords', async () => {
    const rows = await t.db.select({ password: authAccount.password }).from(authAccount).where(eq(authAccount.providerId, 'credential'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.password).not.toContain(PASSWORD);
  });
});
