# @ecomkit/admin-shell

The admin frame every store gets: sidebar built from the enabled modules' `admin.nav`, top bar (global search, alerts link, staff menu), staff gate, the settings renderer for every module's `settings`, audit log viewer, staff and roles screens, and the dashboard grid of `dashboardWidgets`. Brand-neutral: the store name comes from the host.

## Responsibility

- `/admin` layout: staff see the shell; anyone else gets a 404 (the sign-in page `/admin/login` renders bare). Everything sits behind one Suspense boundary whose fallback is the shell skeleton.
- Sidebar: registry nav sorted by `order`, grouped by band (CONVENTIONS section 5), items the viewer may not open are hidden; the first item of a band is its heading. Phones get the same nav in a left drawer.
- Settings: `/admin/settings` lists modules with settings; `/admin/settings/<module>` renders the zod schema as a form (groups from `.meta({ group })`, labels from `.meta({ title })` or the key, help, placeholder, defaults), secret fields write-only and masked (`••••` + last 4), `settings.actions[]` as buttons with their last result, copyable URLs, and the module's `settings.customPanel` underneath. No module owns a route under `/admin/settings`.
- Audit: `/admin/audit`, filter by record type and id, field-level changes, keyset paging.
- Staff and roles: `/admin/staff` (list, invite, change role, disable, resend invite) and `/admin/roles` (permission matrix per role), both owner only (`staff.manage`).
- Dashboard: `/admin`, date range (default last 30 days IST) and a 4-column grid of `dashboardWidgets` filtered by permission; each widget streams behind its own skeleton and error boundary.

## Public API

| Export | What |
|---|---|
| `@ecomkit/admin-shell/admin` | `AdminLayout`, `DashboardPage`, `SettingsIndexPage`, `SettingsPage`, `AuditPage`, `StaffPage`, `RolesPage`, `ActionForm` (the one admin form island), `PageHeader`, `NoAccess` |
| `@ecomkit/admin-shell/server` | `requireAdmin(permission?)` (page guard: 404 non-staff, `forbidden` state for staff without the permission), `saveSettings`, `runSettingsAction`, `loadSettingsView`, `settingsIndex`, `searchAdmin`, `loadAudit`, `staffForms`, `failure`, `requestMeta` |
| `@ecomkit/admin-shell/domain` | pure helpers: `adminGate`, `navSections`, `activeHref`, `describeSettings`, `formToPatch`, `safeRedirect`, `parseRange`, `istDate`, `auditChanges`, `searchProviders`, `settingsUrls`, types `FormState`, `StaffAdmin`, `AdminSearchProvider`, `SettingsUrl` |
| `@ecomkit/admin-shell/manifest` | nav: Home (0), Settings (900), Staff (980), Roles (985), Audit log (990) |

Permissions used: `settings.read` (view), `settings.write` (save, run actions), `settings.secrets` (change a secret; owner only), `audit.read`, `staff.manage`.

## Host files (the app wires these; they need the app registry)

Package pages cannot import the app's generated registry, so the host keeps seven thin files under `app/(admin)/admin/` that pass the registry and server actions in. Copy them from `apps/shop` for a new store:

```
layout.tsx                 <AdminLayout registry search title> with an inline 'use server' search action
page.tsx                   <DashboardPage registry searchParams>
settings/page.tsx          <SettingsIndexPage registry>
settings/[module]/page.tsx <SettingsPage registry params save runAction> with inline 'use server' save/run
audit/page.tsx             <AuditPage searchParams>
staff/page.tsx             <StaffPage staff={auth} actions searchParams>   (auth = @ecomkit/auth/server)
roles/page.tsx             <RolesPage staff={auth} save>
```

Pages take `params` / `searchParams` as the promises Next passes and await them inside their own Suspense boundary, so client navigation shows the page skeleton at once (cache components).

## Tables, routes, events, jobs

None of its own. Reads and writes `core_settings` and `core_audit_log` through `@ecomkit/core/settings` and `@ecomkit/core/audit`. Emits no events; no jobs.

## Extension points it renders

- `admin.nav[]`, `settings` (`schema`, `actions[]`, `customPanel`), `dashboardWidgets[]` (contract).
- `adminSearch[]` and `settingsUrls[]`: extra manifest keys, read structurally and validated with zod until they join the core contract (requested). Shapes:

```ts
adminSearch: [{ id: 'orders', label: 'Orders', order: 0, permission: 'orders.read',
  search: () => import('./server/admin-search').then((m) => m.search) }] // (q, limit) => [{ id, title, subtitle?, href: '/admin/...' }]
settingsUrls: [{ label: 'Webhook URL', path: '/api/webhooks/<provider>', help: '...' }]
```

- Settings actions: `kind: 'oauth-redirect'` results must carry an https or same-origin `redirectUrl`; anything else is refused. Every run is audited (`settings.action`), which is also the "last run" shown next to the button. A throwing action is captured under Health and reported as failed.
- `StaffAdmin` port: the staff and roles screens call `listStaff, inviteStaff, setStaffRole, setStaffDisabled, resendInvite, getRoleMatrix, setRolePermissions`, which `@ecomkit/auth/server` exports.

## Admin list pattern (DataTable)

Every admin list: parse the URL with `parseTableParams(await searchParams, { filters, sorts, defaultSort })` from `@ecomkit/ui/domain`, query one page on the server with a tiebreak on id, and render `<DataTable params total pageSize basePath filters />`. `StaffPage` is the reference implementation.

## How to disable

Leave `admin-shell` out of `modules.config.ts` and delete the host files above; the store then has no admin UI. It depends on `core`, `ui` and `auth` (without auth everyone is a guest and every admin page 404s).
