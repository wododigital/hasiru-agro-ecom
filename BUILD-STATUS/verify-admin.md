# Verify: admin (2026-10-20, 07:14-07:32 IST)

Setup: `pnpm db:fresh verify-admin` (migrated, `jobs:install`), the 07:12 shared `next build` copied to a private standalone dir and run on :3202 with `ENABLE_MOCKS=0`. Owner and support sessions minted by `tooling/smoke.mjs`.
Run: `DATABASE_URL=postgres://localhost:5433/ecomkit_verify_admin INTERNAL_SECRET=<server's> node tooling/smoke.mjs --base=http://localhost:3202 --only=routes,admin`

| Check | Result | Detail |
|---|---|---|
| Owner session accepted on /admin | PASS | 200 |
| Every admin route (nav entries, sub-entries, detail pages reached from lists) renders for an owner | PASS | 63 PASS, 0 FAIL (final run 07:28); `/admin/dev/*` 404 in production by design |
| Admin detail pages with no record to link to | SKIP (7) | assistant, menus, customers, enquiries, health errors, inventory, order invoice.pdf: unseeded DB |
| Every settings section renders (17 modules) | PASS | no render error inside Suspense, each has an h1 |
| Settings save round-trip (ai-assistant) | PASS | `core_settings.updated_at` moves |
| Integration key save (payments.clientSecret) | PASS | stored `is_secret=t`, sealed `{v,ct,iv}`; audit row says `"replaced"`, no plaintext |
| Create discount rule | PASS | 303 to the new rule; `discounts_rule` row |
| Audit rows written by the saves | PASS | `core_audit_log` grows (settings.update, discount.create) |
| Role matrix: support nav hides Settings/Analytics | PASS | |
| Role matrix: support denied /admin/settings/payments, no key fields | PASS | NoAccess page |
| Role matrix: support can open /admin/orders | PASS | |
| Save product / price / stock count | SKIP | `seed:load` did not reach catalog before 07:32 (media processing; also SIGTERMed twice by another agent's cleanup). Checks are in the smoke and run once products exist |

## Fixed (tooling/smoke.mjs only; no admin code needed changing)
- Discount check posted fields the form does not have (`code/title/type` into `discounts_code`); now posts the rule form (`name/kind/valueType/value`) and checks `discounts_rule`. It was a false FAIL.
- Settings save picked `/admin/settings/ai-assistant` blindly; now `store` or the first section with a save form.
- New: a 200 page whose RSC payload carries a non-`NEXT_` `E{digest}` (render error inside a Suspense boundary) is a FAIL. Every admin page answered 200 while its body crashed under a bad env, so the old check missed it.
- New admin checks: every settings section renders, integration-key save is sealed and redacted in the audit, price save (`pricing_price`), stock count (`inventory_level.on_hand`), support-role matrix.
- `mintCookie(role)` generalises the owner session minting.

## Open
- Outside admin scope, found by the new Suspense-error check (for the storefront/account verifier): `/account/profile`, `/account/addresses`, `/account/land`, `/account/reviews` answer 200 to an anonymous visitor while a module `NotFoundError` (status 404) crashes the body (digest 593880585); it should be `notFound()` or the login redirect `/account` already does. `/videos` links to `/policies/*`, `/farm-development`, `/why-choose-us`, which 404 on an unseeded DB (seed content; recheck after seed).
- Product/price/stock saves unverified on a seeded DB (time). Run the command above after `seed:load` finishes.
- Seed load is slow (media derivatives, minutes) and gets killed by concurrent agents' `pkill`; owner of the swarm should serialise seeds.
