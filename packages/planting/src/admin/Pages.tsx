import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@ecomkit/core/auth-context';
import { listProducts } from '@ecomkit/catalog/server';
import { Badge, Button, buttonVariants, Checkbox, Input, Select, Table, TBody, Td, Textarea, Th, THead, Tr } from '@ecomkit/ui';
import { ROLES, type ModelWithMembers, type Role } from '../domain';
import { loadModel, loadModels } from '../server/models';
import { orElse } from '../server/runtime';
import { removeMemberForm, saveMemberForm, saveModelForm } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const ROLE_NAME: Record<Role, string> = { M: 'Main', X: 'Host', O: 'Biomass' };

function patternText(m: ModelWithMembers): string {
  const p = m.pattern;
  if (p.kind === 'random') return `Random mix M ${p.mix.M} / X ${p.mix.X} / O ${p.mix.O}`;
  return `${p.kind === 'line' ? 'Line' : 'Rows'}: ${p.rows.join(' | ')}`;
}

function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  if (one(sp.saved)) return <p className="rounded-sm bg-surface-2 p-3 text-sm text-success">Saved.</p>;
  if (one(sp.error)) return <p className="rounded-sm bg-surface-2 p-3 text-sm text-danger">Not saved: {one(sp.error)}</p>;
  return null;
}

/** Admin > Products > Planting models ("Recommendation management"). */
export async function ModelsPage({ searchParams }: { searchParams: SP }) {
  await requirePermission('products.write');
  const [models, sp] = await Promise.all([loadModels(), searchParams]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Planting models</h1>
          <p className="text-sm text-muted">Patterns, spacing and the plants each model recommends, with their main (M), host (X) and biomass (O) roles. Unlock mode lives under Settings &gt; Planting.</p>
        </div>
        <Link href="/admin/planting/new" className={buttonVariants({ size: 'sm' })}>
          New model
        </Link>
      </div>
      <Flash sp={sp} />
      <Table>
        <THead>
          <Tr>
            <Th>Model</Th>
            <Th>Pattern</Th>
            <Th>Spacing</Th>
            <Th>Plants (M / X / O)</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <TBody>
          {models.map((m) => (
            <Tr key={m.slug}>
              <Td>
                <Link href={`/admin/planting/${m.slug}`} className="font-medium underline">
                  {m.name}
                </Link>
                <div className="text-xs text-muted">{m.slug}</div>
              </Td>
              <Td className="font-mono text-xs">{patternText(m)}</Td>
              <Td>
                {m.spacingFt.plant} ft{m.blockFt.h ? ` x ${m.spacingFt.row} ft` : ' along the line'}
              </Td>
              <Td>{ROLES.map((r) => m.members.filter((x) => x.role === r).length).join(' / ')}</Td>
              <Td>
                <Badge tone={m.isActive ? 'success' : 'neutral'}>{m.isActive ? 'Active' : 'Hidden'}</Badge>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

const spacingText = (v: ModelWithMembers['members'][number]['spacingFt']) => (v === null ? '' : Array.isArray(v) ? `${v[0]}x${v[1]}` : String(v));

/** Admin > Products > Planting models > one model: fields and members (add, change role, default pick, remove). */
export async function ModelEditPage({ params, searchParams }: { params: Promise<{ model: string }>; searchParams: SP }) {
  await requirePermission('products.write');
  const [{ model: slug }, sp] = await Promise.all([params, searchParams]);
  const creating = slug === 'new';
  const model = creating ? null : await loadModel(slug);
  if (!creating && !model) notFound();
  const plants = (await orElse(() => listProducts({ kind: 'plant', sort: 'name', limit: 2000 }), { rows: [], total: 0 })).rows;
  const nameOf = new Map(plants.map((p) => [p.id, p.name]));
  const members = model?.members ?? [];
  const memberIds = new Set(members.map((m) => m.productId));
  const p = model?.pattern;
  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/admin/planting" className="underline">
          Planting models
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{model ? model.name : 'New model'}</h1>
      <Flash sp={sp} />

      <form action={saveModelForm} className="grid max-w-3xl gap-4 rounded-md border border-border bg-surface p-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Slug</span>
          <Input name="slug" defaultValue={model?.slug ?? ''} readOnly={!creating} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Name</span>
          <Input name="name" defaultValue={model?.name ?? ''} required maxLength={80} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Kannada name</span>
          <Input name="nameKn" defaultValue={model?.nameKn ?? ''} maxLength={80} lang="kn" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Position</span>
          <Input name="position" type="number" min={0} defaultValue={model?.position ?? 0} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="font-semibold">Description (HTML, sanitised on save)</span>
          <Textarea name="descriptionHtml" rows={3} defaultValue={model?.descriptionHtml ?? ''} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Pattern type</span>
          <Select name="patternKind" defaultValue={p?.kind ?? 'rows'}>
            <option value="rows">Rows (strings cycle per row and column)</option>
            <option value="random">Random mix (Miyawaki style)</option>
            <option value="line">Line (boundary)</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Rows (one per line, letters M, X, O)</span>
          <Textarea name="rows" rows={3} defaultValue={p && p.kind !== 'random' ? p.rows.join('\n') : ''} className="font-mono" />
        </label>
        <fieldset className="grid grid-cols-4 gap-2 text-sm sm:col-span-2">
          <legend className="font-semibold">Random mix shares and seed</legend>
          {(['M', 'X', 'O'] as const).map((r) => (
            <label key={r} className="space-y-1">
              <span>{r}</span>
              <Input name={`mix${r}`} type="number" step="0.05" min={0} max={1} defaultValue={p?.kind === 'random' ? p.mix[r] : ''} />
            </label>
          ))}
          <label className="space-y-1">
            <span>Seed</span>
            <Input name="seed" type="number" defaultValue={p?.kind === 'random' && p.seed !== null ? p.seed : ''} />
          </label>
        </fieldset>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Plant spacing along the row (ft)</span>
          <Input name="colSpacingFt" type="number" step="0.5" min={0.5} defaultValue={model?.spacingFt.plant ?? 6} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Row spacing (ft, 0 for a line)</span>
          <Input name="rowSpacingFt" type="number" step="0.5" min={0} defaultValue={model?.spacingFt.row ?? 12} />
        </label>
        {(['M', 'X', 'O'] as const).map((r) => (
          <label key={r} className="space-y-1 text-sm">
            <span className="font-semibold">Legend {r}</span>
            <Input name={`legend${r}`} defaultValue={model?.legend[r] ?? ROLE_NAME[r]} required maxLength={40} />
          </label>
        ))}
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Cart weight per plant (kg, optional)</span>
          <Input name="weightOverrideKg" type="number" step="0.1" min={0} defaultValue={model?.weightOverrideKg ?? ''} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isActive" defaultChecked={model?.isActive ?? true} />
          Active on the storefront
        </label>
        <div className="sm:col-span-2">
          <Button type="submit">Save model</Button>
        </div>
      </form>

      {model ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Plants in this model ({members.length})</h2>
          <p className="text-sm text-muted">Default picks are recommended first (within each role, up to the per-role count in settings); the rest are offered as more varieties. Plants not suited to the visitor&apos;s district are left out automatically.</p>
          <Table>
            <THead>
              <Tr>
                <Th>Plant</Th>
                <Th>Role</Th>
                <Th>Position</Th>
                <Th>Spacing (ft)</Th>
                <Th>Default pick</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {members.map((x) => {
                const formId = `member-${x.productId}`;
                return (
                  <Tr key={x.productId}>
                    <Td>
                      {nameOf.get(x.productId) ?? <span className="text-muted">Not visible in the shop</span>}
                      <div className="font-mono text-[10px] text-muted">{x.productId}</div>
                    </Td>
                    <Td>
                      <Select name="role" form={formId} defaultValue={x.role} aria-label="Role">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r} {ROLE_NAME[r]}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Input name="position" form={formId} type="number" min={0} defaultValue={x.position} className="w-20" aria-label="Position" />
                    </Td>
                    <Td>
                      <Input name="spacingFt" form={formId} defaultValue={spacingText(x.spacingFt)} className="w-24" aria-label="Spacing" placeholder="18x18" />
                    </Td>
                    <Td>
                      <Checkbox name="isDefaultPick" form={formId} defaultChecked={x.isDefaultPick} aria-label="Default pick" />
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <form id={formId} action={saveMemberForm}>
                          <input type="hidden" name="model" value={model.slug} />
                          <input type="hidden" name="productId" value={x.productId} />
                          <Button type="submit" size="sm" variant="outline">
                            Save
                          </Button>
                        </form>
                        <form action={removeMemberForm}>
                          <input type="hidden" name="model" value={model.slug} />
                          <input type="hidden" name="productId" value={x.productId} />
                          <Button type="submit" size="sm" variant="ghost">
                            Remove
                          </Button>
                        </form>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <form action={saveMemberForm} className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-4">
            <input type="hidden" name="model" value={model.slug} />
            <label className="space-y-1 text-sm">
              <span className="block font-semibold">Add plant</span>
              <Select name="productId" required className="min-w-64">
                {plants
                  .filter((pl) => !memberIds.has(pl.id))
                  .map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-semibold">Role</span>
              <Select name="role" defaultValue="M">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r} {ROLE_NAME[r]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-semibold">Spacing</span>
              <Input name="spacingFt" placeholder="18x18" className="w-24" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="isDefaultPick" />
              Default pick
            </label>
            <Button type="submit">Add</Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
