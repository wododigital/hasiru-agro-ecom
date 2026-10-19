# @ecomkit/media

Uploads, the sharp image pipeline, the media library (licence and credit fields), derivative generation in the worker, and private files behind signed URLs. Depends on `core` only. Brand-neutral.

## How images flow

1. Bytes arrive through `uploadFile()` (the upload route, another module's form handler, or the seed hook).
2. The type is decided from the bytes (`domain.sniff`): JPEG, PNG, GIF, WebP, AVIF images and PDF documents. SVG, HEIC and anything else are refused. The client's filename and Content-Type are ignored.
3. Images are decoded with a 50 MP cap, EXIF orientation applied, fitted inside 2560 px (never enlarged) and re-encoded as a WebP master. sharp writes no input metadata, so EXIF/GPS and anything hidden in the original container is dropped. A 16 px WebP blur placeholder is stored on the row.
4. Files get random names (`<aa>/<32 hex>`) under `MEDIA_ROOT`, outside the web root: `public/m/…` for public masters, `public/d/…` for derivatives, `private/…` for private files.
5. Identical bytes (sha256) return the existing asset, also under concurrent uploads.
6. Public images start `processing`; the `media.warm` job generates AVIF (q50) + WebP (q75) at every width of the ladder 160, 320, 480, 640, 800, 960, 1280, 1920 that does not exceed the master (never upscaled; a master narrower than 160 gets one derivative at its own width), plus one `share.jpg` at the largest width for consumers that need JPEG. Then the asset is `ready`.
7. Rendering: `getImages(ids)` returns `ImageRef`s (core contract) for `ui/ImageWithFallback`. `ImageRef.src` is the master URL `/media/m/<aa>/<hex>.webp`. With the loader below configured, `next/image` requests `/media/w/<width>/<aa>/<hex>` and the route answers with the smallest stored derivative that covers the width, AVIF when the browser accepts it (`Vary: Accept`), WebP otherwise. Before derivatives exist it serves the master with a 60 s cache.

## Public API

| Export | What |
|---|---|
| `@ecomkit/media/server` | `uploadFile(input)`, `uploadImage(input)` (images only), `getImage(id)`, `getImages(ids)` (batched), `imageProps(id, sizes)` (props for `ImageWithFallback`), `toImageRef(asset)`, `getAsset`, `findBySha256`, `assetIdsBySha256(hashes)` (for importers), `deriveAsset(id)`, `queueWarm(id)`, `trackUsage / releaseUsage / listUsage`, `updateAsset`, `deleteAsset` (refuses used assets with `MediaInUseError`), `listAssets`, `listDerivatives`, `signedUrl(id, { ttlSec })`, `verifySignedUrl`, `handleUpload`, `handleMediaGet`, `mediaRoot`, `mediaSrc`, `shareSrc`, `UploadError` (`code`: `unsupported_type`, `svg_refused`, `heic_unsupported`, `not_allowed`, `too_large`, `corrupt`, `empty`; `status` is the HTTP code) |
| `@ecomkit/media/domain` | `sniff`, `planWidths`, `pickDerivative`, `parseMediaPath`, `mediaLoader` (next/image loader), `mediaSrc`, `assetMetaSchema` (zod for library fields), `creditLine`, constants (`MAX_UPLOAD_BYTES` 12 MB, `DERIVATIVE_WIDTHS`, `QUALITY`, `MASTER_MAX_PX`) |
| `@ecomkit/media/admin` | `LibraryPage`, `AssetPage` |
| `@ecomkit/media/messages` | `mediaMessages` (upload error copy, credit prefix) |
| `@ecomkit/media/schema` | `mediaAsset`, `mediaDerivative`, `mediaUsage` |

Linking a file to a record: call `trackUsage(assetId, '<table>', id, { tx })` when saving and `releaseUsage` when unlinking. The library refuses to delete anything still used. Private files: issue `signedUrl(id)` only after your own permission or ownership check (default lifetime 10 minutes).

Uploads from storefront forms (enquiry photos, review photos): call `uploadImage({ bytes, originalName, isPrivate, usage })` from your own route handler after your own rate limit and form guards; show `mediaMessages.errors[err.code]` on `UploadError`.

## Tables

- `media_asset`: plan section 3 columns plus `is_private` (signed URLs only), `updated_at`, and source value `client` (owner's own photos, used by the seed manifest).
- `media_derivative(asset_id, format avif|webp|jpeg, width, storage_key, bytes)`, pk `(asset_id, format, width)`, cascades with the asset.
- `media_usage(asset_id, entity, entity_id)`, pk all three, index `(entity, entity_id)`, `restrict` on asset delete.

## Routes

| Path | Kind | Notes |
|---|---|---|
| `POST /api/media/upload` | route | Staff with `media.write`. Multipart: `file` plus optional `alt, caption, source, licence, author, sourceUrl, creditRequired, private`. Same-origin only. JSON (`201` new, `200` deduped, `4xx` with `error` code) or `303` for the plain HTML form (works without JS). |
| `GET /media/[...path]` | route | `m/…` masters and `d/…` derivatives (immutable), `w/<width>/<aa>/<hex>` negotiated size, `s/<id>?e=&t=` signed private file (`no-store`, `sandbox` CSP, attachment for documents). Anything else 404. |
| `/admin/media` | admin page | Upload form, library list with kind/source/licence filters (missing credit, unknown licence), usage counts. |
| `/admin/media/[id]` | admin page | Preview, alt/caption/licence/author/source URL/credit fields, usages, generated sizes, regenerate, delete when unused. |

## Host setup

- `MEDIA_ROOT`: absolute path, the same for the web process, the worker and `pnpm seed:load` (default `<cwd>/storage/media`). On the VPS point it at a `shared/` directory so releases keep the files.
- `next.config.ts`: `images: { loader: 'custom', loaderFile: './image-loader.ts' }` with `apps/<app>/image-loader.ts` = `export { mediaLoader as default } from '@ecomkit/media/domain';`. Without it everything still works through Next's built-in optimizer on the master.
- nginx may serve `/media/m/` and `/media/d/` straight from `$MEDIA_ROOT/public/` with `expires max`; `/media/w/` and `/media/s/` must reach the app. `client_max_body_size 12m` on `/api/media/upload`.

## Settings, events, jobs, extension points

- Settings: none.
- Events: emits none, consumes none.
- Jobs: `media.warm` (`{ assetId }` after an upload; with no data it sweeps assets stuck in `processing` for 5+ minutes). Schedule: every 15 minutes (sweep).
- Health check: `media-storage` (readiness): the storage root is writable.
- Seed hook `import-masters`: reads `data/media/media-manifest.json` (`data/seed/SCHEMA.md`) and imports each `masters/<file>` with its source, licence, author, source URL and credit flag; derivatives inline; idempotent by sha256 (a second run changes nothing); `--dry-run` writes nothing. Default alt text comes from the file name.
- Permissions: `media.write`. Nav: Products band, `Media` at order 240.

## How to disable

Remove `media` from the app's `modules.config.ts` and run `modules:sync`. Modules that render images take `ImageRef | null` and show the `ImageWithFallback` placeholder when there is none; modules that store files (enquiries, reviews, orders invoices) list `media` as a dependency and must be disabled with it.
