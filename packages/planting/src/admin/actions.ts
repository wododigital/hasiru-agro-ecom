'use server';

import { redirect } from 'next/navigation';
import { ForbiddenError } from '@ecomkit/core/auth-context';
import type { Pattern } from '../domain';
import { removeMember, saveMember, saveModel } from '../server/models';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** "18x18" or "18 x 18" -> [18, 18]; "10" -> 10; empty -> null. */
function parseSpacing(raw: string): [number, number] | number | null {
  const parts = raw.split(/\s*[x×,]\s*/i).filter(Boolean).map(Number);
  if (parts.length === 2 && parts.every((n) => n > 0)) return [parts[0]!, parts[1]!];
  return parts.length === 1 && parts[0]! > 0 ? parts[0]! : null;
}

function patternFrom(f: FormData): Pattern {
  const kind = str(f, 'patternKind');
  const rows = str(f, 'rows')
    .split(/\r?\n/)
    .map((r) => r.replace(/\s+/g, '').toUpperCase())
    .filter(Boolean);
  if (kind === 'random') return { kind, mix: { M: Number(str(f, 'mixM')), X: Number(str(f, 'mixX')), O: Number(str(f, 'mixO')) }, seed: str(f, 'seed') ? Number(str(f, 'seed')) : null };
  if (kind === 'line') return { kind, rows: rows.slice(0, 1) };
  return { kind: 'rows', rows };
}

async function guard(back: string, fn: () => Promise<unknown>): Promise<never> {
  let target = `${back}${back.includes('?') ? '&' : '?'}saved=1`;
  try {
    await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    target = `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent((err as Error).name === 'ZodError' ? 'invalid' : (err as Error).message.slice(0, 80))}`;
  }
  redirect(target);
}

export async function saveModelForm(f: FormData): Promise<void> {
  const slug = str(f, 'slug');
  await guard(`/admin/planting/${slug || 'new'}`, () =>
    saveModel({
      slug,
      name: str(f, 'name'),
      nameKn: str(f, 'nameKn'),
      descriptionHtml: str(f, 'descriptionHtml'),
      colSpacingFt: str(f, 'colSpacingFt'),
      rowSpacingFt: str(f, 'rowSpacingFt') || '0',
      pattern: patternFrom(f),
      legend: { M: str(f, 'legendM'), X: str(f, 'legendX'), O: str(f, 'legendO') },
      weightOverrideKg: str(f, 'weightOverrideKg'),
      position: str(f, 'position') || '0',
      isActive: f.get('isActive') === 'on',
    }),
  );
}

export async function saveMemberForm(f: FormData): Promise<void> {
  const model = str(f, 'model');
  await guard(`/admin/planting/${model}`, () =>
    saveMember({
      model,
      productId: str(f, 'productId'),
      role: str(f, 'role'),
      position: str(f, 'position') || '0',
      isDefaultPick: f.get('isDefaultPick') === 'on',
      spacingFt: parseSpacing(str(f, 'spacingFt')),
    }),
  );
}

export async function removeMemberForm(f: FormData): Promise<void> {
  const model = str(f, 'model');
  await guard(`/admin/planting/${model}`, () => removeMember({ model, productId: str(f, 'productId') }));
}
