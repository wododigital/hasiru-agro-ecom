# @ecomkit/monitoring

Health endpoints and checks, developer alerting (fingerprinted alert issues with dedupe, critical repeats until acked, hourly and daily digests, webhook fallback, in-admin bell) and the Health screens (overview, alerts, errors, jobs, logs). Hard dependency: `core`. Optional: `notifications` (email and WhatsApp delivery), `seo` (404 log link).

## Wiring (host app)

Call once in the web process (instrumentation `register()`) and in `worker.ts`, after the registry exists:

```ts
import { configureMonitoring } from '@ecomkit/monitoring/server';
configureMonitoring({ registry });
```

Unbound, monitoring still runs its built-in checks and alerts through the webhook and the bell; manifest health checks and the notifications service need the registry. `instrumentation.ts` should export core's `onRequestError` (`@ecomkit/core/observability`) so server errors reach `core_error_issue`, which the minute scan turns into alerts.

## Public API (`@ecomkit/monitoring/server`)

| Function | What |
|---|---|
| `alert({ rule, fingerprint, title, body?, severity? }, { now? })` | Raise or count an alert issue. New critical/high issues notify at once (unless they flapped back inside the rule's dedupe window); further occurrences add to `count`. Returns null when the rule is off. Emits `alert.raised` for a new issue. |
| `resolveAlert(rule, fingerprint)` / `resolveAlertById(id, actorId)` | Resolve; sends a "Resolved" notice for notified critical/high issues. |
| `ackIssue(alertId, actorId)` | Acknowledge: stops critical repeats. Audited. |
| `reconcile(rule, activeConditions)` | For scans: raise what is new, resolve what cleared, leave continuing issues alone. |
| `sendRepeats()`, `sendDigest('high' \| 'low')` | Used by the jobs. |
| `registerHealthCheck(check)` | Add a `HealthCheck` from host code (modules use the manifest `healthChecks` extension point). |
| `runChecks({ readinessOnly?, record? })`, `readiness()` | Run checks (5 s timeout each); readiness summary memoised 5 s. |
| `recordCheck(check, ok, { detail? })` | Write a check result (also used for the backup marker). |
| `bellCounts()`, `listAlerts()`, `listRules()`, `updateRule()` | Admin reads and rule edits. |
| `integrationCards()`, `listQueues()`, `listFailedJobs()`, `retryJob()`, `listIssues()`, `getIssue()`, `setErrorIssueStatus()` | Health screen read models and actions. |
| `configureMonitoring({ registry, notifications?, postWebhook?, statDisk? })` | Runtime binding (tests swap transports). |

Domain (`@ecomkit/monitoring/domain`, pure): `DEFAULT_RULES`, `notifyOnOpen`, `nextRepeatAt`, `channelsToAvoid`, `isCriticalRoute`, health evaluators (`heartbeatHealth`, `diskHealth`, `expiryProblem`, `rdapExpiry`, `dnsMissing`, `overallStatus`), `monitoringSettingsSchema`.

Admin (`@ecomkit/monitoring/admin`): `HealthOverviewPage`, `AlertsPage`, `ErrorsPage`, `ErrorDetailPage`, `JobsPage`, `LogsPage`, `AlertsWidget` (dashboard widget), `AlertBell` (top bar).

## Alert routing

| Severity | When it goes out | Channels (default) |
|---|---|---|
| critical | at once, then every `repeat_minutes` (30) until acked | WhatsApp + email to the developer |
| high | at once, then activity in the hourly digest | email |
| low | daily digest at 09:00 IST | email |

- The alert row is written first; the bell (open count, red when critical) always shows it.
- Delivery uses the notifications service (`alert.critical`, `alert.digest`, `test.send` templates; vars `text, title, body, severity, count, status, url`). When nothing went out that way (module off, send failed, no recipient, hourly limit, or the alert is about that channel, e.g. `integration.failed` for `gmail`), the fallback webhook gets `{ text, content, kind, rule, fingerprint, ... }`. A rule may also list `webhook` as a regular channel.
- Per channel at most 20 messages per hour (`core.rateLimit`, key `monitoring-alert:<channel>`).
- Dedupe: one unresolved issue per (rule, fingerprint) (partial unique index). A resolved issue that fires again inside the rule's `dedupe_minutes` of its last notification opens a new issue quietly (flapping); after the window it notifies again.

Default rules (rows in `monitoring_alert_rule` override): `error.issue`, `error.spike`, `integration.failed`, `health.down` (critical), `health.degraded` (low), `jobs.dead-letter`, `jobs.backlog`, `uptime.live` (critical), `ssl.expiry`, `domain.expiry`, `dns.records`, `backup.stale`, `db.connections`. Unknown keys get severity-based defaults, so a module can raise its own.

## What is watched

| Every minute (`monitoring.tick`) | |
|---|---|
| Health checks | built-ins (database round trip, worker heartbeat under 2 min, disk over 10% free and writable folders) + `registerHealthCheck` + every module's `healthChecks`. `down` -> `health.down` (critical when the check is critical), `degraded` -> `health.degraded` (low). |
| Server errors | open `core_error_issue` rows (level error, seen in 7 days) -> `error.issue`, critical on `/checkout`, `/pay`, `/api/webhooks`; more than `errorSpikeThreshold` events in 10 min -> `error.spike`. Resolving or ignoring the issue resolves the alert. |
| Jobs | jobs waiting in `<queue>.dead` -> `jobs.dead-letter`; more than `jobBacklogLimit` waiting in a queue -> `jobs.backlog`. |
| Integrations | `integration.failed` events: 3 failures of one provider + operation in 15 min -> `integration.failed`; resolved when its latest call is ok. |
| Uptime | the worker calls `selfCheckUrl` (default `INTERNAL_BASE_URL/api/health/live`) -> `uptime.live`. |
| Repeats | critical reminders. |

| Daily 02:40 IST (`monitoring.daily`) | |
|---|---|
| Certificates | TLS expiry under 14 days -> `ssl.expiry` (an unreadable certificate also alerts). |
| Domains | RDAP registration expiry under 30 days -> `domain.expiry` (unknown expiry is recorded, not alerted). |
| DNS | A, MX, SPF, DMARC present -> `dns.records`. |
| Backups | last ok `backup.nightly` result older than `backupMaxAgeHours` -> `backup.stale`. |
| Database | size and connection use recorded; 80% of `max_connections` -> `db.connections`. |
| Retention | check results 30 days, resolved alerts 90 days. |

Backup marker: the nightly backup script records its success with
`psql "$DATABASE_URL" -c "insert into monitoring_check_result (\"check\", ok, detail) values ('backup.nightly', true, '{}')"`.

## Routes

| Path | What |
|---|---|
| `GET /api/health/live` | 200 `{ status, release, uptimeSec }`, no dependencies. |
| `GET /api/health/ready` | 200 or 503 (any readiness check down) with `{ status, checks: [{ id, status }] }`; no details. Point the external uptime checker here. |
| `/admin/health` | Overview: check results, uptime 24 h, open alerts, failed jobs, integration cards, workers, 404 link (SEO). |
| `/admin/health/alerts` | Alert issues (status, severity filters; Ack, Resolve) and the rules form. |
| `/admin/health/errors`, `/admin/health/errors/[id]` | Errors by fingerprint with Resolve / Ignore / Reopen, latest events with stacks. |
| `/admin/health/jobs` | Queue counts, failed and dead-lettered jobs with Retry. |
| `/admin/health/logs` | Integration call log (provider, status) and check results (failing only). |

All Health pages need `health.read` (everyone else gets a 404). Ack, resolve and error status changes need `health.read`; rule edits `settings.write`; Retry `jobs.retry`.

## Tables

`monitoring_alert_rule`, `monitoring_alert` (unique `(rule_key, fingerprint)` where not resolved), `monitoring_check_result`. Reads core's `core_error_issue`, `core_error_event`, `core_integration_log`, `core_job_heartbeat` and pg-boss's `pgboss.job`.

## Settings (`/admin/settings/monitoring`)

`devEmail`, `devPhone`, `fallbackWebhookUrl` (secret), `selfCheckUrl`, `domains`, `diskPaths`, `backupMaxAgeHours` (26), `jobBacklogLimit` (500), `errorSpikeThreshold` (20). Action: **Send test alert** (one message through every channel, reports where it went).

## Events and jobs

Emits `alert.raised`. Consumes `integration.failed`. Jobs: `monitoring.tick` (every minute), `monitoring.digest-high` (hourly), `monitoring.digest-low` (09:00), `monitoring.daily` (02:40), all Asia/Kolkata.

## Extension points used

`healthChecks` (consumed), `dashboardWidgets` (`monitoring.alerts`), `settings.actions` (`monitoring.test-alert`). Other modules report problems by adding a `healthChecks` entry (down / degraded with a detail), by calling `integrationCall` (core), or, for module-specific rules, through the `monitoring` server API when they depend on it.

## Disable

Remove `monitoring` from `modules.config.ts` and run `modules:sync`: the health routes and Health screens disappear, nothing else depends on it. Note `/api/health/*` go with it; keep the module on wherever an uptime checker points at the store.
