# @ecomkit/enquiries

Generic enquiry pipeline: a public form that works without JavaScript (multipart POST + 303), honeypot and signed time trap, per-IP rate limit, private uploads, statuses, assignee, remarks and staleness. Feeds lead intake through the customers module. Brand-neutral.

## Public API

`@ecomkit/enquiries/server`:
- `configureEnquiries({ contacts?, files? })`: called once at app boot. `contacts` is `contactPort` from `@ecomkit/customers/server` (lead creation, contact hashing, masking); `files` is the media module's private store (`putPrivate`, `read`). Both optional: without contacts no lead is created and support sees fully hidden contacts; without files uploads are dropped with a log warning.
- `handleEnquiryPost(req)`: the `/api/enquiry` handler. Order: body cap -> rate limit `enquiry:<ipHash>` 5/hour -> `formGuards` (a honeypot hit answers "sent" and stores nothing; too fast, forged or expired token -> `retry`) -> zod (`farmDevelopmentSchema`) -> attachments (max 5, 10 MB each, jpeg/png/webp/heic/pdf) -> `createEnquiry`. Answers `303` to the form's `_return` path (same-site relative only) with `?enquiry=sent|invalid|retry|rate_limited|attachment#enquiry`, or JSON when the request accepts it.
- `createEnquiry(input, { files, ipHash, sourcePath, utm })`: one transaction: enquiry row -> `contacts.upsertLead({ source: 'enquiry', context: { ref: enquiryId, ... } })` (exactly one lead, which emits `lead.created`) -> attachments -> `enquiry.created`. Enquiries never talk to the ERP.
- Staff (`enquiries.read` / `enquiries.write`): `listEnquiries({ q, status })` (name/location substring, phone by hash), `pipeline()` (board), `getEnquiry(id)`, `transition(id, to)` (audited, emits `enquiry.status_changed`), `assign(id, staffId | null)`, `addNote(id, body)`, `readAttachment(id)`, `lastEnquiry()` (dashboard staleness), `presentEnquiry(row, viewer)` (masking).

`@ecomkit/enquiries/domain`: `ENQUIRY_KINDS`, `ENQUIRY_STATUSES` (new, contacted, site_assessment, design, quotation, project, closed_won, closed_lost; staff may move to any status), `enquiryFormSchema`, `farmDevelopmentSchema` (farm development needs acres >= 1 and a location; other kinds need a requirement), `ATTACHMENT_LIMITS`, `STALE_AFTER_DAYS` (3, open and untouched), `QUIET_AFTER_DAYS` (7, dashboard amber), `isStale`, `quietness`, `pickUtm`, `safeReturnPath`.

`@ecomkit/enquiries/ui`: `EnquiryForm({ kind, returnTo, searchParams, landFields?, uploads?, messages? })`, a server component; render it inside `<Suspense>` because the time token is issued per request. Carries UTM/click ids from the page's search params into hidden fields. Copy: `enquiriesMessages`.

`@ecomkit/enquiries/admin`: `EnquiriesPage` (list with status filter and search, or `?view=board`), `EnquiryDetailPage` (status, assign to me, remarks, attachment downloads), `EnquiryStalenessWidget` (dashboard).

## Tables
`enquiries_enquiry` (adds `customer_notes` for the visitor's own notes), `enquiries_attachment` (media id + file name, type, size), `enquiries_note`; enums `enquiries_kind`, `enquiries_status`. No foreign keys into customers, places, media or auth.

## Routes
`POST /api/enquiry` (public), `GET /api/admin/enquiries/attachments/[id]` (`enquiries.read`; `private, no-store`, `attachment`, `nosniff`; forbidden and missing both answer 404). Admin pages `/admin/enquiries`, `/admin/enquiries/[id]`.

## Events
Emits `enquiry.created` (for staff and customer notifications: templates `enquiry.received_admin`, `enquiry.received_customer`) and `enquiry.status_changed`. Consumes none.

## Extension points
`dashboardWidgets`: `enquiries.staleness` ("last enquiry N days ago", amber after 7 days, count of stale open enquiries).

## Settings, jobs
None (limits are constants in `domain`).

## Disabling
Remove `enquiries` from the app config; pages that render `EnquiryForm` must be removed with it (the Hasiru `/build-farm-with-us` page does).

## Tests
`test/enquiries.test.ts` (real Postgres, real handler with `Request`/`FormData`): no-JS submit -> 303 + one enquiry + exactly one lead request + `enquiry.created`, files to private storage only; JSON mode; honeypot, too-fast and forged tokens; zod field errors; open-redirect guard; file type/count limits; 5/hour rate limit (6th is 429); no customers wired; support masking (with and without customers); transition + audit + event; notes; board; staleness; attachment download only for `enquiries.read`, never cached. The real customers + enquiries path (one `customers_lead`, one `lead.created`) is `apps/shop/test/wp-16-enquiry-lead.test.ts`.
