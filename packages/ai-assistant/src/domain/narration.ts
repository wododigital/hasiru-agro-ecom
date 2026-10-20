import { formatINR, type Paise } from '@ecomkit/core/money';
import type { AssistantMessages } from '../messages';
import type { Facts, ProductFact } from './types';

/** `fill('Add {name}', { name: 'Teak' })`. Unknown keys stay as written. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

const rs = (p: number) => formatINR(p as Paise);

/**
 * The facts exactly as the narrator sees them: products under short refs (`p1`..`p6`, never ids), every number
 * already formatted. The narration may only restate these strings; the validator checks it did.
 */
export interface ModelProduct {
  ref: string;
  name: string;
  category: string | null;
  price: string | null;
  bulk: string | null;
  stock: string;
  traits: string[];
  area: string | null;
}
export interface ModelFacts {
  mode: string;
  question: string;
  lead: string | null;
  notes: string[];
  products: ModelProduct[];
  closing: string | null;
}

export interface FactsView {
  view: ModelFacts;
  /** ref -> product id */
  refs: ReadonlyMap<string, string>;
}

function stockText(p: ProductFact, f: AssistantMessages['facts']): string {
  switch (p.stock) {
    case 'in_stock':
      return f.inStock;
    case 'low_stock':
      return f.lowStock;
    case 'preorder':
      return f.preorder;
    case 'out_of_stock':
      return f.outOfStock;
    default:
      return '';
  }
}

const years = (b: NonNullable<ProductFact['bearingYears']>) => (b.max != null && b.max !== b.min ? `${b.min} to ${b.max}` : `${b.min}`);

export function toModelFacts(facts: Facts, m: AssistantMessages): FactsView {
  const f = m.facts;
  const district = facts.district?.name ?? '';
  const refs = new Map<string, string>();
  const products = facts.products.map((p, i): ModelProduct => {
    const ref = `p${i + 1}`;
    refs.set(ref, p.id);
    const traits: string[] = [];
    if (p.bearingYears) traits.push(fill(f.bears, { years: years(p.bearingYears) }));
    if (p.shade) traits.push(f.shade);
    if (p.nitrogenFixer) traits.push(f.nitrogen);
    if (p.fit && district) traits.push(fill(p.fit === 'good' ? f.fitGood : p.fit === 'ok' ? f.fitOk : f.fitPoor, { district }));
    return {
      ref,
      name: p.name,
      category: p.collectionLine,
      price: p.unitPaise != null ? fill(f.each, { price: rs(p.unitPaise) }) : null,
      bulk: p.bulk ? fill(f.bulk, { price: rs(p.bulk.unitPaise), qty: p.bulk.minQty }) : null,
      stock: stockText(p, f),
      traits,
      area: p.areaQty ? fill(f.qtyForArea, { qty: p.areaQty.qty.toLocaleString('en-IN'), acres: p.areaQty.acres, spacing: p.areaQty.spacing }) : null,
    };
  });
  const a = m.answers;
  const lead = !products.length ? null : facts.companionOf ? fill(a.introCompanions, { name: facts.companionOf.name }) : facts.district ? fill(a.introFit, { district }) : a.intro;
  return {
    view: {
      mode: facts.mode,
      question: facts.question,
      lead,
      notes: facts.notes.map((n) => a[n]),
      products,
      closing: products.length ? a.closing : null,
    },
    refs,
  };
}

export interface Narration {
  /** Markdown-lite with `[[ref]]` (model view) or `[[id]]` (after `resolveRefs`) product tokens. */
  answer: string;
  productIds: string[];
  followUps: string[];
}

/**
 * The deterministic answer: the mock narrator, the fallback on any model error or refusal, and the whole answer
 * when the assistant runs in template mode. Built only from the model view, so it passes the validator by
 * construction.
 */
export function templateNarration(view: ModelFacts, suggestions: readonly string[] = []): Narration {
  const parts: string[] = [];
  if (view.lead) parts.push(view.lead);
  const lines = view.products.map((p) => {
    const bits = [p.price, p.bulk, p.stock, ...p.traits, p.area].filter((b): b is string => !!b);
    return `- [[${p.ref}]]${bits.length ? `: ${bits.join(', ')}` : ''}.`;
  });
  if (lines.length) parts.push(lines.join('\n'));
  for (const n of view.notes) parts.push(n);
  if (view.closing) parts.push(view.closing);
  const asked = view.question.trim().toLowerCase();
  return {
    answer: parts.join('\n\n'),
    productIds: view.products.map((p) => p.ref),
    followUps: suggestions.filter((s) => s.toLowerCase() !== asked).slice(0, 3),
  };
}

/** `[[p2]]` -> `[[<product id>]]`; refs not in the map were already dropped by the validator. */
export function resolveRefs(n: Narration, refs: ReadonlyMap<string, string>): Narration {
  return {
    answer: n.answer.replace(/\[\[(p\d+)\]\]/g, (all, ref: string) => (refs.has(ref) ? `[[${refs.get(ref)}]]` : '')),
    productIds: n.productIds.flatMap((r) => (refs.has(r) ? [refs.get(r)!] : [])),
    followUps: n.followUps,
  };
}
