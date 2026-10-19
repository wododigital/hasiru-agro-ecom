# @ecomkit/customers

Customer profiles (plain contact plus keyed hashes, masked by role), addresses with a district link, the single consent store, leads, land profiles and four computed segments. Brand-neutral.

## Public API

`@ecomkit/customers/server` (server only):

| Function | Who | What |
|---|---|---|
| `hashContact(value)` | anyone | HMAC-SHA256 (key derived from `INTERNAL_SECRET`, purpose `contact-hash`) of a phone (normalised to E.164) or email (lowercased), 22 chars. Used for search and matching |
| `ensureProfile({ userId, name?, phone?, email?, customerType?, source? }, { tx? })` | auth hook, checkout | idempotent create; emits `customer.created` once |
| `getMyProfile()`, `updateMyProfile(input)` | signed-in customer | zod-validated (GSTIN, email), audited |
| `getCustomer(id)`, `listCustomers({ q, page })` | `customers.read` | personal data masked for `support`; `q` matches a phone/email by hash or a name by substring |
| `exportCustomerData(id)` | `customers.export` | DPDP export: profile, addresses, consents, leads, land; audited |
| `recordOrder({ userId, amountPaise, at }, { tx })` | orders module | keeps `orders_count`, `lifetime_paise`, first/last order dates that the segments read |
| `listMyAddresses()`, `saveMyAddress(input)`, `deleteMyAddress(id)` | signed-in customer | scoped to the viewer; someone else's id is a 404; one default address (partial unique index) |
| `listMyLand()`, `saveMyLand(input)`, `deleteMyLand(id)` | signed-in customer | same scoping; `purpose` is a free slug (e.g. a planting model) |
| `recordConsent({ subject, purpose, granted, textShown, source, ipHash?, userAgent? }, { tx?, actor?, leadId? })` | anyone | appends a row (never updates), writes an audit row, emits `consent.changed`, one transaction |
| `hasConsent(subject, purpose)` | anyone | newest row for any of the subject's identifiers (`userId`, `phone`, `email`) decides; no row means no |
| `consentHistory(subject)`, `listConsent({ purpose })` | account page, `customers.read` | |
| `upsertLead({ name, phone, source, phoneVerified?, userId?, context }, { tx? })` | wizard, notify-me, enquiry, chat, checkout | the one lead entity. Same phone + source + `context.ref` while open updates that lead (and can only raise `phone_verified`); otherwise inserts and emits `lead.created`, the only event that pushes leads to the ERP |
| `listLeads({ status, source })`, `setLeadStatus(id, status)` | `customers.read` / `customers.write` | |
| `segmentCounts()`, `segmentMembers(key, { districtId? })` | `customers.read` | over the four views |
| `contactPort` | host wiring | `{ upsertLead, hashContact, maskPhone, maskEmail, seesFullPii }`; pass it to modules that must not import customers (`configureEnquiries({ contacts: contactPort })`) |

`@ecomkit/customers/domain`: zod schemas (`profileInputSchema`, `addressInputSchema`, `landInputSchema`, `consentInputSchema`, `leadInputSchema`, `phoneSchema`), `maskPhone` (`+91 98•••••210`), `maskEmail` (`r•••@example.com`), `seesFullPii(viewer, ownerId?)`, `maskPii(row, viewer)`, `GSTIN_RE`, `PINCODE_RE`, enum lists.

`@ecomkit/customers/ui`: `ProfileView`, `AddressesView`, `LandView` (server components; forms post to server actions in `ui/actions.ts` and work without JS: outcome comes back as `?saved=1` or `?error=invalid|not_found`). Copy: `@ecomkit/customers/messages` (`customersMessages`).

`@ecomkit/customers/admin`: `CustomersListPage`, `CustomerDetailPage`, `LeadsPage`, `SegmentsPage`, `ConsentPage`.

## Masking rule
Full phone/email only for staff whose role is not `support` and who hold `customers.read`, and for the customer themself. Everyone else gets masked values. Fails closed.

## Tables
`customers_profile` (pk `user_id`), `customers_address`, `customers_consent` (append-only), `customers_lead`, `customers_land_profile`; enums `customers_type`, `customers_consent_purpose`, `customers_consent_status`, `customers_lead_source`, `customers_lead_status`.
Views: `customers_v_segment_first_order` (orders_count = 1), `customers_v_segment_bulk_buyer` (lifetime >= Rs 25,000 or tag `bulk`), `customers_v_segment_by_district` (default address, else newest), `customers_v_segment_wizard_lead_no_order` (wizard leads not converted whose phone has no customer with an order).
No foreign keys to auth or places (both may be disabled); ownership is enforced in every query.

## Routes
Storefront: `/account/profile`, `/account/addresses`, `/account/land` (noindex; the account layout from auth signs the visitor in). Admin: `/admin/customers`, `/admin/customers/[id]`, `/admin/leads`, `/admin/segments`, `/admin/consent`.

## Settings, jobs
None.

## Events
Emits `customer.created`, `lead.created`, `consent.changed`. Consumes none.

## Disabling
Remove `customers` from the app config. Modules that create leads through `contactPort` (enquiries) keep working without leads; marketing and analytics must treat a missing consent store as "no consent".

## Tests
`test/customers.test.ts` (real Postgres): masking by role, hash search, profile validation + audit, addresses default handling and IDOR (read/update/delete as another customer = 404), land IDOR, consent grant/revoke/history/audit/events, lead dedupe + `phone_verified` + single `lead.created`, all four segment views. `test/manifest.test.ts`: manifest resolves, every route module exports what its stub re-exports.
