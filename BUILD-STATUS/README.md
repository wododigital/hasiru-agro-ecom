# Per-package status files

Each agent writes exactly one file here, `BUILD-STATUS/wp-xx.md`, and never edits `BUILD-STATUS.md` (the orchestrator merges these after each wave). Copy this template:

```
# WP-xx <package> (status: todo|running|blocked|done|failed)   updated <ISO timestamp IST>

## Shipped
- <what exists now, with paths>

## Tests
| Command | Result |
|---|---|
| pnpm -F @ecomkit/<mod> typecheck | pass / fail (n errors) |
| pnpm -F @ecomkit/<mod> lint | |
| pnpm -F @ecomkit/<mod> test | n passed, n failed |

## Assumptions (numbered A<wp>-1.., dated)

## Cross-package requests (to -> what -> why; status open)

## Known failures / flaky tests

## Incomplete / next steps
```

Rules: report what you ran and saw (exit codes, counts), not what you expect. Write assumptions instead of asking questions. A dependency or contract change is a request here, never an edit.
