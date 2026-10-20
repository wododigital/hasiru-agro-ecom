# @ecomkit/planting-3d

3D / 2D viewer of a planting layout (`PlanLayout` contract from `@ecomkit/core/contracts`): a repeating patch of the plan with procedural trees per plant form, a realistic mango tree (glTF), M/X/O basin rings, a 5.5 ft person for scale, spacing labels, tap to identify, walk mode (thumbstick, W A S D and arrows, Esc), a sun slider, and a flat 2D plan with canopy circles and a scale bar.

## Performance

- The route renders the 2D plan as server SVG first. After hydration the 3D view takes over unless the visitor prefers reduced motion or `navigator.deviceMemory < 4` (then 2D stays the default).
- three, OrbitControls and GLTFLoader live in one lazy chunk (`src/ui/scene.ts`, never imported statically). `View3dLinkIsland` / `preload3d()` start downloading it on hover, focus or touch of a "View in 3D" link.
- Measured: island 14 KB gz, three chunk 160 KB gz (Vite test), and in the real `next build` the route totals about 354 KB gz of JS (shell 192 + island 3 + three 159), under the 450 KB budget. `test/bundle.test.ts` guards it.
- The mango model (`assets/mango.glb`, 347 KB) is emitted by the bundler as a hashed static file. Its embedded textures load through `<img>` (img-src allows `blob:`), not fetch.

## Public API

- `@ecomkit/planting-3d/domain`: `patchPoints`, `buildViewerData`, `patchSpecFor`, `DEFAULT_PATCHES` (commercial 13 x 3, food forest 7 x 7, miyawaki 7 x 7 at 0.45, boundary 15 x 1), `archetypeFor`, `CANOPY_RADIUS_FT`, `prefers2d`, `sunLight`, `walkStep`, `stickVector`.
- `@ecomkit/planting-3d/server`: `configurePlanting3d({ layout, patches?, messages? })`. `layout({ modelSlug, planId })` returns `{ layout: PlanLayout, hints?: Record<productId, { name, canopy, group }>, landSqft? }` or null.
- `@ecomkit/planting-3d/ui`: `PlantingViewerIsland`, `Plan2d`, `View3dLinkIsland`, `preload3d`, `ViewerSkeleton`.

## Routes

`/models/[model]/3d?plan=<planId>` (noindex). Without `plan` it shows the model's sample layout. 404 when the slug is invalid, the source returns null, or no source is bound.

## Tables, settings, events, jobs

None.

## How to disable

Remove `planting-3d` from `modules.config.ts` and run `modules:sync`; "View in 3D" links (planting) should render only when `registry.has('planting-3d')`.
