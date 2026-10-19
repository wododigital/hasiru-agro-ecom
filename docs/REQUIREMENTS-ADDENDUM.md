# Requirements addendum (Shyam, 2026-10-20)

Applies on top of BUILD-PLAN.md. Where they conflict, this file wins.

1. **Pick-and-choose modules.** Every feature is a self-contained package that a new store can include or leave out. A future e-com project must be able to start from the shared core, select only the modules it wants (e.g. catalog + cart + checkout + payments, without planting models or the truck meter), and get a working store. Concretely:
   - Each module declares a manifest (id, dependencies, DB schema/migrations, storefront routes, admin nav + pages, settings fields, jobs, events emitted/consumed).
   - The host app enables modules from one config list; admin nav, settings pages, migrations and jobs assemble from the enabled manifests only.
   - Modules talk through the core event bus and declared contracts, never by importing each other's internals. Optional cross-module features (e.g. abandoned cart using WhatsApp) degrade cleanly when the other module is off.
   - Hasiru-specific logic (planting models, M/X/O diagrams, truck capacity, compost calculator) lives in its own modules, not inside generic ones.
   - Document a "new store from these modules" recipe and prove it with a test: a minimal app enabling only core + catalog + cart + checkout + payments builds and passes its E2E smoke test.
2. **Fully autonomous run.** No human input until the finished, tested local build. Decide sensible defaults and record them under "Assumptions" in BUILD-STATUS.md.
3. **No code reuse from other WODO projects.** Learn the behaviour, implement fresh in this stack and naming.
4. **Avoid redundancy from the start**, and audit after each wave to remove it.
5. **Speed without breaking UX.** Optimise loading (code-split, lazy load, prefetch on intent, skeletons); never drop features or design to get a score.
6. **Missing plant images:** real photos only (Magnific stock, not AI; or Wikimedia Commons open licence with attribution recorded).
7. **Model routing:** Fable plans, orchestrates and verifies; Opus 5.5 does the real work; Sonnet only for simple, repetitive code.
8. **Git:** commit locally on `ecom-build`; do not push.
