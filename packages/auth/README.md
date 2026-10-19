# @ecomkit/auth

Sign-in and authorisation for the store. Customers sign in with a 6-digit one-time code sent to their phone (WhatsApp authentication template, through the notifications module) or email; there are no customer passwords. Staff sign in with email + password + an authenticator app (TOTP) with backup codes, invite-only. Built on Better Auth 1.7 (phoneNumber, emailOTP, twoFactor, admin plugins, Drizzle adapter). Implements the core `auth-context` contract (`getViewer`, `requirePermission`, `requireOwner`) and owns the staff role matrix.

## Public API

`@ecomkit/auth/server` (server only):

| Function | What |
|---|---|
| `getViewer()` | Current viewer (`guest` / `customer` / `staff`), once per request (React `cache`). Checks bans, the 2FA gate and the 12 h staff limit on every request. |
| `requirePermission(p)`, `requireOwner(customerId)`, `requireStaff()` | Throw `ForbiddenError` (403) / `NotFoundError` (404). Most modules call the core wrappers in `@ecomkit/core/auth-context` instead. |
| `requireCustomer(returnTo?)` | Account pages: the customer, or a redirect to `/account/login?next=`. |
| `authContext` | The `auth` service object (manifest `provides.auth`). |
| `sendOtp({ identifier, ip })`, `verifyOtp({ identifier, code, requestHeaders })` | Customer codes. `identifier` is an Indian mobile (any common format) or an email. Generic answers. |
| `signInStaff`, `verifyStaffSecondFactor`, `beginTotpEnrolment`, `confirmTotpEnrolment`, `signOut` | Staff flows; return Better Auth `headers` (Set-Cookie). Inside server actions the cookies are applied automatically. |
| `inviteStaff`, `resendInvite`, `acceptInvite`, `bootstrapOwner` | Invites (72 h, single use, hashed token). `inviteStaff`/`resendInvite` return the link so the admin can copy it if mail is down. |
| `listStaff`, `setStaffRole`, `setStaffDisabled`, `getRoleMatrix`, `setRolePermissions`, `ensureRolePermissions` | Staff and roles screens (WP-08 renders them). Need `staff.manage`; nobody edits their own role or disables themselves; the last owner cannot be demoted or disabled; `owner` always has every permission. All audited. |
| `staffGate(headers)` | `/admin/login` state: anonymous, enrol, ready, not_staff. |
| `configureAuth(deps)` | Boot wiring, see "Host wiring". |
| `getAuth()`, `authOptions()` | The Better Auth instance and its options. |

Other exports: `./domain` (constants, role helpers, `parseIdentifier`, `safeNextPath`, zod schemas), `./ui` (`AccountLayout`, `CustomerLoginIsland`, `StaffLoginIsland`, `SignOutForm`), `./messages` (`authMessages`), `./schema`, `./manifest`, `./routes/*`.

## Tables

`auth_user` (role `customer` or a staff role, phone, ban and 2FA flags), `auth_session`, `auth_account` (staff password hash), `auth_verification` (hashed customer codes `phone-otp:<E.164>`, hashed email codes, hashed invite tokens `staff-invite:<hmac>`, lockout counters `staff-lockout:<email>`, 2FA cookies), `auth_two_factor` (encrypted TOTP secret and backup codes), `auth_role_permission` (role x permission, seeded from `ROLE_PERMISSIONS`). `test/schema.test.ts` diffs `src/schema.ts` against Better Auth's own table list (`getAuthTables`), which stands in for `auth generate`: a plugin upgrade that adds a field fails the test.

## Routes

| Path | Module | Notes |
|---|---|---|
| `/api/auth/[...all]` | `routes/auth-handler` | Only `/get-session`, `/sign-out`, `/ok`; every other Better Auth path answers 404 (no sign-up, no plaintext phone codes, no admin endpoints over HTTP). |
| `/account` | `routes/account` | Greeting; requires a customer. |
| `/account/login` | `routes/account-login` | Identifier, then code. `?next=` (same-site paths only). |
| `/admin/login` | `routes/admin-login` | Password, then authenticator code or backup code; first sign-in enrols the authenticator; `?invite=` sets the password. |
| `apps/shop/app/(shop)/account/layout.tsx` | hand-written | `AccountLayout`: nav for signed-in customers, links only to account pages an enabled module declares. |

## Security rules (BUILD-PLAN section 8)

- Codes: 6 digits, 300 s, 3 wrong attempts burn the code, keyed HMAC storage (never plaintext). Send: 3 per identifier per 10 min, 10 per IP per hour. Verify: 5 per identifier per 10 min. Every failure is the same `invalid`; sending answers `sent` whether or not an account exists.
- Staff never get a session from a code: a session hook allows staff sessions only from password sign-in and second-factor paths, and `sendOtp` sends nothing to staff identifiers.
- Staff: invite-only (sign-up disabled), passwords 12 to 128 characters, 10 password tries per IP per 15 min, 5 failures lock the email for 15 min (unknown emails lock too, so a lock reveals nothing), authenticator lockout after 5 wrong codes. A staff account without an authenticator has no permissions (the 2FA gate). Staff sessions end 12 h after sign-in; customer sessions last 30 days.
- Disabled (banned) accounts are checked on every request and their sessions deleted.

## Settings, events, jobs, extension points

- Settings: none.
- Emits `customer.created` when a customer account is created (first sign-in). Consumes nothing.
- Jobs: none. Seed hook `auth.role-permissions` (seeds roles that have no rows; edited roles are left alone).
- Permission declared: `staff.manage`.

## Host wiring

In `instrumentation.ts` `register()` (WP-28):

```ts
setAuthProvider(() => registry.service('auth'));
configureAuth({ notifications: () => registry.service('notifications'), appName: '<store name>' });
```

Without the notifications module, development prints codes and invite links to the server log; production throws (`NotConfiguredError`, captured) and `bootstrapOwner`/`inviteStaff` still return the link.

First owner of a new store: `DATABASE_URL=... INTERNAL_SECRET=... SITE_URL=... pnpm -F @ecomkit/auth exec tsx scripts/bootstrap-owner.ts <email> <name>` prints the invite link (refuses once an owner exists).

Env used: `INTERNAL_SECRET` (Better Auth secret and code/invite hashes are derived from it), `SITE_URL` (cookie origin and invite links), `DATABASE_URL`. No new variables.

## How to disable

Remove `auth` from the app's module list. `@ecomkit/core/auth-context` then treats everyone as a guest and every permission check fails closed, so the admin and account pages become unreachable. Other modules must not import `@ecomkit/auth` directly; they go through core `auth-context`.
