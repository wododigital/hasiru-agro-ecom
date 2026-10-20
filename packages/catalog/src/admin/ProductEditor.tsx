import { can, getViewer, requirePermission } from '@ecomkit/core/auth-context';
import type { ProductFormTab } from '@ecomkit/core/contracts';
import { Badge, DetailFrame, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, buttonVariants } from '@ecomkit/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { productPath } from '../domain/card';
import * as E from '../domain/enums';
import type { Kind } from '../domain/enums';
import { collectionOptions, getProductForEdit, tagOptions } from '../server/admin-queries';
import { catalogRuntime } from '../server/runtime';
import type { ProductRow, VariantRow } from '../schema';
import { deleteProductAction, saveProductAction } from './actions';
import { ActionFormIsland } from './ActionFormIsland';
import { AreaField, Card, CheckField, Grid, SelectField, TextField } from './fields';

const DETAILS = 'sku,kind,slug,name,nameKn,scientificName,baseName,variety,collectionId,subcategory,status,availabilityOverride,isFeatured,isBestSeller,searchAliases';
const PLANT = 'sizeClass,canopy,propagation,nitrogenFixer,droughtTolerance,waterNeed,exposure,tempMin,tempOpt,tempMax,humidityMin,humidityOpt,humidityMax,rainfallMin,rainfallMax,soilTags,matureHeightMinFt,matureHeightMaxFt,bearingYearsMin,bearingYearsMax,timberRotationYears,yieldText,harvestSeason,attributes,spacingFt,compostKg';
const INPUT = 'inputType,packSize,dosageRules';
const CONTENT = 'shortDescription,descriptionHtml,careHtml,seoTitle,seoDescription,focusKeyword,noindex';
const LOGISTICS = 'weightKg,packingFeePaise,hsn,gstRate,taxClass,bagSize,heightAtDispatchFt';
const PROVENANCE = 'dataSource,needsReview,reviewNotes,imageNeeded,legacySku,legacyWooId,erpItemId';

const spacingText = (v: [number, number] | number | null | undefined) => (Array.isArray(v) ? `${v[0]} x ${v[1]}` : '');

function Hidden({ id, fields }: { id: string | null; fields: string }) {
  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="_fields" value={fields} />
    </>
  );
}

async function DetailsSection({ p, kind, tagIds, secondaryIds }: { p: ProductRow | null; kind: Kind; tagIds: readonly string[]; secondaryIds: readonly string[] }) {
  const [collections, tags] = await Promise.all([collectionOptions(), tagOptions()]);
  const own = collections.filter((c) => c.kind === kind);
  return (
    <ActionFormIsland action={saveProductAction} saveBar={!!p} submitLabel={p ? 'Save details' : 'Create product'} cta="admin-product-save-details">
      <Hidden id={p?.id ?? null} fields={DETAILS} />
      <input type="hidden" name="_tags" value="1" />
      <Grid>
        <TextField name="name" label="Name" value={p?.name} required />
        <TextField name="slug" label="Slug" value={p?.slug} required help="Lowercase words joined by hyphens. Changing it keeps the old URL redirecting." />
        <TextField name="sku" label="SKU" value={p?.sku} required />
        <SelectField name="kind" label="Kind" value={p?.kind ?? kind} options={E.KINDS} blank={false} />
        <SelectField name="status" label="Status" value={p?.status ?? 'draft'} options={E.STATUSES} blank={false} />
        <SelectField name="availabilityOverride" label="Availability override" value={p?.availabilityOverride} options={E.AVAILABILITY_OVERRIDES} />
        <TextField name="nameKn" label="Local-language name" value={p?.nameKn} />
        <TextField name="scientificName" label="Scientific name" value={p?.scientificName} />
        <TextField name="baseName" label="Base name" value={p?.baseName} />
        <TextField name="variety" label="Variety" value={p?.variety} />
        <SelectField name="collectionId" label="Collection" value={p?.collectionId} options={own.map((c) => ({ value: c.id, label: c.parentId ? `  ${c.name}` : c.name }))} />
        <TextField name="subcategory" label="Subcategory label" value={p?.subcategory} />
      </Grid>
      <AreaField name="searchAliases" label="Search aliases" value={p?.searchAliases.join('\n')} rows={3} help="One per line: other spellings, local names, old names." />
      <div className="flex flex-wrap gap-4">
        <CheckField name="isBestSeller" label="Best seller" checked={p?.isBestSeller ?? false} />
        <CheckField name="isFeatured" label="Featured" checked={p?.isFeatured ?? false} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Tags</legend>
        <div className="flex flex-wrap gap-3">
          {tags.map((t) => (
            <CheckField key={t.id} name="tagIds" value={t.id} label={`${t.name} (${t.kind})`} checked={tagIds.includes(t.id)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Also list in</legend>
        <div className="flex flex-wrap gap-3">
          {own
            .filter((c) => c.id !== p?.collectionId)
            .map((c) => (
              <CheckField key={c.id} name="secondaryCollectionIds" value={c.id} label={c.name} checked={secondaryIds.includes(c.id)} />
            ))}
        </div>
      </fieldset>
    </ActionFormIsland>
  );
}

function PlantSection({ p }: { p: ProductRow }) {
  const s = p.spacingFt ?? {};
  const c = p.compostKg;
  return (
    <ActionFormIsland action={saveProductAction} saveBar submitLabel="Save plant data" cta="admin-product-save-plant">
      <Hidden id={p.id} fields={PLANT} />
      <Grid>
        <SelectField name="sizeClass" label="Size class" value={p.sizeClass} options={E.SIZE_CLASSES} />
        <SelectField name="canopy" label="Canopy" value={p.canopy} options={E.CANOPIES} />
        <SelectField name="propagation" label="Propagation" value={p.propagation} options={E.PROPAGATIONS} />
        <SelectField name="droughtTolerance" label="Drought tolerance" value={p.droughtTolerance} options={E.LEVELS} />
        <SelectField name="waterNeed" label="Water need" value={p.waterNeed} options={E.WATER_NEEDS} />
        <SelectField name="exposure" label="Sunlight" value={p.exposure} options={E.EXPOSURES} />
        <TextField name="tempMin" label="Temperature min (°C)" value={p.tempMin} type="number" step="any" />
        <TextField name="tempOpt" label="Temperature optimum (°C)" value={p.tempOpt} type="number" step="any" />
        <TextField name="tempMax" label="Temperature max (°C)" value={p.tempMax} type="number" step="any" />
        <TextField name="humidityMin" label="Humidity min (%)" value={p.humidityMin} type="number" step="any" />
        <TextField name="humidityOpt" label="Humidity optimum (%)" value={p.humidityOpt} type="number" step="any" />
        <TextField name="humidityMax" label="Humidity max (%)" value={p.humidityMax} type="number" step="any" />
        <TextField name="rainfallMin" label="Rainfall min (mm/yr)" value={p.rainfallMin} type="number" />
        <TextField name="rainfallMax" label="Rainfall max (mm/yr)" value={p.rainfallMax} type="number" />
        <TextField name="matureHeightMinFt" label="Mature height min (ft)" value={p.matureHeightMinFt} type="number" step="any" />
        <TextField name="matureHeightMaxFt" label="Mature height max (ft)" value={p.matureHeightMaxFt} type="number" step="any" />
        <TextField name="bearingYearsMin" label="Bearing from (years)" value={p.bearingYearsMin} type="number" step="any" />
        <TextField name="bearingYearsMax" label="Bearing to (years)" value={p.bearingYearsMax} type="number" step="any" />
        <TextField name="timberRotationYears" label="Timber rotation (years)" value={p.timberRotationYears} type="number" step="any" />
        <TextField name="yieldText" label="Yield" value={p.yieldText} />
        <TextField name="harvestSeason" label="Harvest season" value={p.harvestSeason} />
        <TextField name="attr.fruit_size" label="Fruit size" value={p.attributes.fruit_size} />
        <TextField name="attr.fruit_shape" label="Fruit shape" value={p.attributes.fruit_shape} />
        <TextField name="attr.intercropping" label="Intercropping" value={p.attributes.intercropping} />
        <TextField name="attr.bearing_years" label="Bearing (display text)" value={p.attributes.bearing_years} />
        <TextField name="attr.timber_rotation_years" label="Timber rotation (display text)" value={p.attributes.timber_rotation_years} />
      </Grid>
      <CheckField name="nitrogenFixer" label="Fixes nitrogen" checked={p.nitrogenFixer} />
      <AreaField name="soilTags" label="Soil tags" value={p.soilTags.join('\n')} rows={2} help="One per line." />
      <h3 className="font-semibold">Spacing per model (ft)</h3>
      <Grid>
        <TextField name="spacing.food_forest" label="Food forest (L x W)" value={spacingText(s.food_forest)} />
        <TextField name="spacing.miyawaki" label="Miyawaki (L x W)" value={spacingText(s.miyawaki)} />
        <TextField name="spacing.commercial" label="Commercial (L x W)" value={spacingText(s.commercial)} />
        <TextField name="spacing.boundary" label="Boundary (ft along the line)" value={typeof s.boundary === 'number' ? s.boundary : ''} type="number" step="any" />
      </Grid>
      <h3 className="font-semibold">Compost per plant (kg)</h3>
      <Grid>
        <TextField name="compost.at_planting" label="At planting" value={c?.at_planting} type="number" step="any" />
        <TextField name="compost.y0_2" label="Years 0 to 2 (per application)" value={c?.y0_2} type="number" step="any" />
        <TextField name="compost.y3_6" label="Years 3 to 6 (per application)" value={c?.y3_6} type="number" step="any" />
        <TextField name="compost.y7_plus" label="Year 7 on (per application)" value={c?.y7_plus} type="number" step="any" />
      </Grid>
    </ActionFormIsland>
  );
}

function InputSection({ p }: { p: ProductRow }) {
  return (
    <ActionFormIsland action={saveProductAction} saveBar submitLabel="Save input data" cta="admin-product-save-input">
      <Hidden id={p.id} fields={INPUT} />
      <Grid>
        <TextField name="inputType" label="Input type" value={p.inputType} help="compost, biochar, seeds, liquid, bio_pesticide" />
        <TextField name="packSize" label="Pack size" value={p.packSize} />
      </Grid>
      <AreaField name="dosageRules" label="Dosage rules (JSON)" value={p.dosageRules ? JSON.stringify(p.dosageRules, null, 2) : ''} rows={6} />
    </ActionFormIsland>
  );
}

function ContentSection({ p }: { p: ProductRow }) {
  return (
    <ActionFormIsland action={saveProductAction} saveBar submitLabel="Save content" cta="admin-product-save-content">
      <Hidden id={p.id} fields={CONTENT} />
      <AreaField name="shortDescription" label="Short description" value={p.shortDescription} rows={3} />
      <AreaField name="descriptionHtml" label="Description (HTML)" value={p.descriptionHtml} rows={10} help="Sanitised on save: headings, lists, tables and links are kept." />
      <AreaField name="careHtml" label="Care guide (HTML)" value={p.careHtml} rows={8} />
      <Grid>
        <TextField name="seoTitle" label="SEO title" value={p.seoTitle} />
        <TextField name="focusKeyword" label="Focus keyword" value={p.focusKeyword} />
      </Grid>
      <AreaField name="seoDescription" label="SEO description" value={p.seoDescription} rows={2} />
      <CheckField name="noindex" label="Hide from search engines (noindex)" checked={p.noindex} />
    </ActionFormIsland>
  );
}

function VariantsSection({ p, variants }: { p: ProductRow; variants: readonly VariantRow[] }) {
  const rows = [...variants, null];
  return (
    <ActionFormIsland action={saveProductAction} saveBar submitLabel="Save variants and logistics" cta="admin-product-save-variants">
      <Hidden id={p.id} fields={LOGISTICS} />
      <input type="hidden" name="_variants" value="1" />
      <Grid>
        <TextField name="weightKg" label="Default weight (kg)" value={p.weightKg} type="number" step="any" />
        <TextField name="packingFeePaise" label="Packing fee (paise)" value={p.packingFeePaise} type="number" />
        <TextField name="hsn" label="HSN" value={p.hsn} />
        <TextField name="gstRate" label="GST rate (%)" value={p.gstRate} type="number" step="any" />
        <TextField name="taxClass" label="Tax class" value={p.taxClass} />
        <TextField name="bagSize" label="Bag size" value={p.bagSize} />
        <TextField name="heightAtDispatchFt" label="Height at dispatch (ft)" value={p.heightAtDispatchFt} type="number" step="any" />
      </Grid>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>Default</th>
            <th>Label</th>
            <th>SKU suffix</th>
            <th>Height (ft)</th>
            <th>Bag</th>
            <th>Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v, i) => (
            <tr key={v?.id ?? 'new'}>
              <td>
                <input type="radio" name="variant.default" value={String(i)} defaultChecked={v?.isDefault ?? false} aria-label="Default variant" />
                <input type="hidden" name="variant.id" value={v?.id ?? ''} />
              </td>
              <td>
                <input name="variant.label" defaultValue={v?.label ?? ''} aria-label="Variant label" className="w-full rounded-sm border border-border px-2 py-1" />
              </td>
              <td>
                <input name="variant.skuSuffix" defaultValue={v?.skuSuffix ?? ''} aria-label="SKU suffix" className="w-20 rounded-sm border border-border px-2 py-1" />
              </td>
              <td>
                <input name="variant.heightFt" defaultValue={v?.heightFt ?? ''} type="number" step="any" aria-label="Height" className="w-20 rounded-sm border border-border px-2 py-1" />
              </td>
              <td>
                <input name="variant.bagSize" defaultValue={v?.bagSize ?? ''} aria-label="Bag size" className="w-24 rounded-sm border border-border px-2 py-1" />
              </td>
              <td>
                <input name="variant.weightKg" defaultValue={v?.weightKg ?? ''} type="number" step="any" aria-label="Weight" className="w-20 rounded-sm border border-border px-2 py-1" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">Fill the last row to add a variant; clear a label to remove that variant. Prices and stock live on their own tabs.</p>
    </ActionFormIsland>
  );
}

function ProvenanceSection({ p }: { p: ProductRow }) {
  return (
    <ActionFormIsland action={saveProductAction} saveBar submitLabel="Save provenance" cta="admin-product-save-provenance">
      <Hidden id={p.id} fields={PROVENANCE} />
      <div className="flex flex-wrap gap-4">
        <CheckField name="needsReview" label="Needs review" checked={p.needsReview} />
        <CheckField name="imageNeeded" label="Needs a real photo" checked={p.imageNeeded} />
      </div>
      <AreaField name="reviewNotes" label="Review notes / open questions" value={p.reviewNotes.join('\n')} rows={4} help="One per line. Shown on the Data gaps page." />
      <AreaField name="dataSource" label="Data source per field group" value={Object.entries(p.dataSource ?? {}).map(([k, v]) => `${k}: ${v ?? ''}`).join('\n')} rows={6} help="One per line as group: source (price: researched)." />
      <Grid>
        <TextField name="legacySku" label="Legacy SKU" value={p.legacySku} />
        <TextField name="legacyWooId" label="Legacy store id" value={p.legacyWooId} type="number" />
        <TextField name="erpItemId" label="ERP item id" value={p.erpItemId} />
      </Grid>
    </ActionFormIsland>
  );
}

/** A productFormTabs entry from another module (pricing, inventory, media, seo...). */
async function InjectedTab({ tab, productId }: { tab: ProductFormTab; productId: string }) {
  const Component = await tab.component();
  return <Component productId={productId} />;
}

const panel = 'flex flex-col gap-4 pt-4 data-[state=inactive]:hidden';

/** /admin/products/new: details only; the other tabs appear once the product exists. */
export async function ProductCreatePage({ kind }: { kind: Kind }) {
  await requirePermission('products.write');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{kind === 'input' ? 'New input' : 'New plant'}</h1>
      <Card title="Details">
        <DetailsSection p={null} kind={kind} tagIds={[]} secondaryIds={[]} />
      </Card>
    </div>
  );
}

/** /admin/products/[id]: catalog tabs plus every enabled module's productFormTabs the viewer may see. */
export async function ProductEditPage({ id }: { id: string }) {
  await requirePermission('products.read');
  const data = await getProductForEdit(id);
  if (!data) notFound();
  const { product: p, variants, tagIds, secondaryCollectionIds } = data;
  const viewer = await getViewer();
  const injected = (catalogRuntime().registry?.list('productFormTabs') ?? []).filter((t) => !t.permission || can(viewer, t.permission));
  const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'data', label: p.kind === 'input' ? 'Input data' : 'Plant data' },
    { id: 'content', label: 'Content' },
    { id: 'variants', label: 'Variants' },
    { id: 'provenance', label: 'Provenance' },
    ...injected.map((t) => ({ id: `${t.moduleId}-${t.id}`, label: t.label })),
  ];
  return (
    <DetailFrame
      title={p.name}
      backHref={p.kind === 'input' ? '/admin/inputs' : '/admin/products'}
      backLabel={p.kind === 'input' ? 'Inputs' : 'Plants'}
      meta={p.sku}
      badges={
        <>
          <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status}</Badge>
          {p.needsReview ? <Badge tone="warning">needs review</Badge> : null}
          {p.imageNeeded ? <Badge tone="warning">photo needed</Badge> : null}
        </>
      }
      primary={
        p.status === 'active' ? (
          <Link href={productPath(p.kind, p.slug)} className={buttonVariants({ variant: 'outline', size: 'sm' })} target="_blank" data-cta="admin-product-view">
            View on store
          </Link>
        ) : null
      }
      more={
        <form action={deleteProductAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="kind" value={p.kind} />
          <button type="submit" className="w-full text-left text-danger" data-cta="admin-product-delete">
            Archive
          </button>
        </form>
      }
    >
      <Tabs defaultValue="details">
        <TabsList aria-label="Product sections">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="details" forceMount className={panel}>
          <DetailsSection p={p} kind={p.kind} tagIds={tagIds} secondaryIds={secondaryCollectionIds} />
        </TabsContent>
        <TabsContent value="data" forceMount className={panel}>
          {p.kind === 'input' ? <InputSection p={p} /> : <PlantSection p={p} />}
        </TabsContent>
        <TabsContent value="content" forceMount className={panel}>
          <ContentSection p={p} />
        </TabsContent>
        <TabsContent value="variants" forceMount className={panel}>
          <VariantsSection p={p} variants={variants} />
        </TabsContent>
        <TabsContent value="provenance" forceMount className={panel}>
          <ProvenanceSection p={p} />
        </TabsContent>
        {injected.map((t) => (
          <TabsContent key={`${t.moduleId}-${t.id}`} value={`${t.moduleId}-${t.id}`} forceMount className={panel} data-injected-tab={t.id}>
            <Suspense fallback={<Skeleton className="h-40 rounded-md" />}>
              <InjectedTab tab={t} productId={p.id} />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </DetailFrame>
  );
}
