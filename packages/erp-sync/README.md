# @ecomkit/erp-sync

ERP adapter interface, order and lead outbox, inventory pull, SKU mapping, sync log, dead-letter alerts.

Status: scaffold only (package.json, src/index.ts). Implemented by WP-27. Hard dependencies: `core`, `orders`, `inventory`. See BUILD-PLAN.md section 2.5 and docs/CONVENTIONS.md.

The implementing work package replaces this file with: responsibility, public API, tables, routes, settings, events (emitted and consumed), jobs, extension points, and how to disable the module.
