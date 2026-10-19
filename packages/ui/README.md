# @ecomkit/ui

Every UI primitive, the semantic design tokens and skeletons. No other package defines its own button, modal, stepper, price formatter, table or image renderer. Brand-neutral: a store themes it by overriding the token variables (see `apps/shop/theme.css`).

## Public API

| Export | What |
|---|---|
| `@ecomkit/ui` | `Button` + `buttonVariants` (style a Link as a button), `Input`, `Textarea`, `Select` (native), `Checkbox` (native), `FormField` (render prop wires label, help, error), `SecretField` (write-only, shows the server-masked value), `DateRange` (two native date inputs), `Segmented` (native radio group), `Dialog` / `DialogContent` (`side`: center, sheet, bottom, left, right), `Sheet` / `SheetContent` (drawer), `Tabs` + `TabsList` + `TabsTrigger` (with `count`) + `TabsContent`, `ToastRegion` + `toast`, `Skeleton`, `Badge`, `Chip` (spec or removable filter chip), `QtyStepper`, `Rail`, `Table` parts, `DataTable`, `EmptyState`, `Stat`, `Sparkline`, `BarChart`, `Breadcrumbs`, `Price`, `Rating`, `ImageWithFallback`, `Marquee`, `StickyBar`, `cn`, `uiMessages` |
| `@ecomkit/ui/domain` | pure helpers: QtyStepper rules (`stepFor`, `incrementQty`, `decrementQty`, `clampQty`, `parseQty`, `showQuickChips`), URL list state (`parseTableParams`, `tableQuery`, `nextSort`, `pageCount`), chart geometry (`sparkPoints`, `barRects`) |
| `@ecomkit/ui/messages` | `uiMessages` default copy (accessible names); every component takes `labels` to override |
| `@ecomkit/ui/tokens.css` | tokens + Tailwind theme + base styles + the admin palette |
| `@ecomkit/ui/manifest` | module manifest (one admin page) |
| `@ecomkit/ui/routes/dev-ui`, `@ecomkit/ui/admin` | stories page |

Rules baked in:
- **QtyStepper** (plan 5.0): Add becomes the stepper (`addButton`), type-in field, Enter or blur commits, Escape reverts, invalid text keeps the old value, never below 0, +10 / +50 chips from 10, step 10 from 100.
- **Price** renders money only through `core.money.formatINR`; compare-at is struck only when higher.
- **Rating** shows stars only with `RATING_MIN_REVIEWS` (3) or more reviews, else the "New" chip (A13).
- **ImageWithFallback** wraps `next/image` with an `ImageRef` (blur placeholder when present) and falls back to a leaf placeholder when the image is missing or fails. Pass `preload` on the one LCP image per page.
- **Rail** is CSS scroll-snap; the desktop arrows are the only JS.
- **DataTable** is server-rendered; q, filters, sort and page live in the URL (`parseTableParams` on the server page, zod-validated, unknown values dropped). Pages are server-paginated instead of virtualised. The toolbar is a GET form that also works without JS.
- **Dialog / Sheet** (radix): focus trap, Esc, backdrop, scroll lock, close button; `side="sheet"` is a bottom sheet on phones and centred from md up.
- **Toast** (sonner): one ARIA-live region; an action click dismisses.

## Tokens and theming

`src/tokens.css` is the only file in `packages/` with colour literals (a test enforces it). It defines the semantic tokens of CONVENTIONS section 8 plus `--color-primary-hover`, `--color-primary-strong`, `--color-ring`, `--color-overlay`, with brand-neutral defaults, switches off Tailwind's default palette (`--color-*: initial`), and defines the neutral admin palette under `[data-surface="admin"]`. A test checks every palette's text pairs for WCAG AA (4.5:1).

An app's `globals.css`:

```css
@import 'tailwindcss';
@import '@ecomkit/ui/tokens.css';
@import '../theme.css';                          /* optional store theme */
@source '../../../packages/*/src/**/*.{ts,tsx}'; /* must end in a file glob */
```

Role colours (`--color-role-*`) are fills; put `text-text` on them, not white (biomass green fails contrast with white).

## Tables, settings, events, jobs

None. No settings, events or jobs.

## Routes

`/admin/dev/ui` (admin page): stories for every primitive in its states. It returns 404 in production builds unless `ENABLE_MOCKS=1` (test builds). E2E: `apps/shop/e2e/wp-01.spec.ts` (axe at 375 and 1440, stepper, dialog, sheet, toast, rail).

## How to disable

Every storefront needs it. Leaving `ui` out of `modules.config.ts` only drops the stories page; components are still imported directly.
