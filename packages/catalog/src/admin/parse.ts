import type { ZodError } from 'zod';
import { productFieldsSchema, variantFieldsSchema, type ProductFields, type VariantFields } from '../domain/product';
import { parseSpacing } from '../domain/sheet';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const numOrNull = (v: FormDataEntryValue | null) => {
  const t = str(v).trim();
  return t === '' ? null : Number(t);
};

/** Field keys a form section posts in `_fields` (absent checkboxes then mean false, not "unchanged"). */
export function readProductForm(fd: FormData, base: ProductFields | null) {
  const keys = str(fd.get('_fields')).split(',').filter(Boolean);
  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'spacingFt') {
      patch.spacingFt = {
        food_forest: parseSpacing(str(fd.get('spacing.food_forest'))),
        miyawaki: parseSpacing(str(fd.get('spacing.miyawaki'))),
        commercial: parseSpacing(str(fd.get('spacing.commercial'))),
        boundary: numOrNull(fd.get('spacing.boundary')),
      };
    } else if (k === 'compostKg') {
      const c = { at_planting: numOrNull(fd.get('compost.at_planting')), y0_2: numOrNull(fd.get('compost.y0_2')), y3_6: numOrNull(fd.get('compost.y3_6')), y7_plus: numOrNull(fd.get('compost.y7_plus')) };
      patch.compostKg = Object.values(c).some((v) => v != null) ? c : null;
    } else if (k === 'attributes') {
      const out: Record<string, string> = {};
      for (const a of ['bearing_years', 'timber_rotation_years', 'fruit_size', 'fruit_shape', 'intercropping']) {
        const v = str(fd.get(`attr.${a}`)).trim();
        if (v) out[a] = v;
      }
      patch.attributes = out;
    } else if (k === 'dataSource') {
      patch.dataSource = Object.fromEntries(
        str(fd.get('dataSource'))
          .split('\n')
          .map((line) => line.split(':').map((s) => s.trim()))
          .filter(([key, value]) => key && value)
          .map(([key, value]) => [key, value]),
      );
    } else if (k === 'dosageRules') {
      const t = str(fd.get('dosageRules')).trim();
      try {
        patch.dosageRules = t ? (JSON.parse(t) as unknown) : null;
      } catch {
        patch.dosageRules = 'invalid';
      }
    } else patch[k] = fd.get(k) ?? '';
  }
  return productFieldsSchema.safeParse({ ...(base ?? {}), ...patch });
}

/** Variant rows posted as parallel arrays (`variant.label` ...); blank label rows are dropped. */
export function readVariants(fd: FormData): { ok: true; variants: VariantFields[] } | { ok: false; error: ZodError } {
  const col = (k: string) => fd.getAll(`variant.${k}`).map(str);
  const labels = col('label');
  const ids = col('id');
  const suffixes = col('skuSuffix');
  const heights = col('heightFt');
  const bags = col('bagSize');
  const weights = col('weightKg');
  const def = str(fd.get('variant.default'));
  const out: VariantFields[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]!.trim()) continue;
    const parsed = variantFieldsSchema.safeParse({
      id: ids[i] ?? '',
      label: labels[i],
      skuSuffix: suffixes[i] ?? '',
      isDefault: def === String(i),
      heightFt: heights[i] ?? '',
      bagSize: bags[i] ?? '',
      weightKg: weights[i] ?? '',
      position: i,
    });
    if (!parsed.success) return { ok: false, error: parsed.error };
    out.push(parsed.data);
  }
  return { ok: true, variants: out };
}

export function fieldErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) (out[issue.path.join('.') || 'form'] ??= []).push(issue.message);
  return out;
}
