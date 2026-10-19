// Step 9.9: FAQs. General questions (the 36 customer-facing ones: pre-sale, pre-planting, post-planting)
// with product_sku null, plus the per-plant question sets from the FAQs and Nursery questions tabs.
// Answers exist only where they follow from the client data or HANDOFF (`derived`, approved); everything
// else is a draft or waits for the client (never invented, never published until approved).
import { join } from 'node:path';
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { cleanLine, once, SOURCES, writeSeedFile } from './lib/common';
import { sheetByName } from './lib/xlsx';
import { buildProducts, LABEL_TO_ROWS, PROPAGATION_TEXT, type ProductRecord } from './fill-gaps';
import { buildModels } from './models';
import { normalizePlants, workbook } from './normalize-plants';

export interface FaqRecord {
  key: string;
  product_sku: string | null;
  question: string;
  answer: string | null;
  source: 'client' | 'derived' | 'ai_draft' | 'woo';
  status: 'approved' | 'draft' | 'needs_client';
  sort: number;
}

/** Spelling fixes for the client's question text (these become public once answered). */
const QUESTION_FIXES: [RegExp, string][] = [
  [/varities/gi, 'varieties'], [/maintanance|maintaince/gi, 'maintenance'], [/genuinity/gi, 'genuineness'], [/requrements/gi, 'requirements'],
  [/folllowed/gi, 'followed'], [/enricging/gi, 'enriching'], [/transplating/gi, 'transplanting'], [/nuturtion/gi, 'nutrition'],
  [/immedietly/gi, 'immediately'], [/(\d+) ?yrs\b/gi, '$1 years'], [/comparion/gi, 'comparison'], [/Gaint/g, 'Giant'], [/\s+\?/g, '?'], [/\s{2,}/g, ' '],
];
/** Competitor names never appear in shop copy. */
const COMPETITOR = /sapling ?mart/i;

export function tidyQuestion(q: string): string {
  let s = cleanLine(q)!.replace(COMPETITOR, 'other nurseries\'');
  s = s.replace(/between other varieties and other nurseries' varieties/i, 'between our varieties and those of other nurseries');
  for (const [re, to] of QUESTION_FIXES) s = s.replace(re, to);
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /[?.]$/.test(s) ? s : `${s}?`;
}

const PROPAGATION_NAMES: Record<string, string> = {
  seeded: 'seed', grafted: 'grafting', air_layered: 'air layering', cuttings: 'cuttings', suckers: 'suckers', tissue_culture: 'tissue culture', other: 'slips',
};

/** Answers for general questions that follow from the data, keyed by a pattern on the question. */
function generalAnswers(products: ProductRecord[]): [RegExp, string][] {
  const plants = products.filter((p) => p.kind === 'plant' && p.status === 'active');
  const props = [...new Set(plants.map((p) => p.plant!.propagation).filter((x): x is NonNullable<typeof x> => !!x))].map((x) => PROPAGATION_NAMES[x]);
  const models = buildModels();
  return [
    [/^Types of propagation/,
      `Our saplings are raised by ${props.slice(0, -1).join(', ')} and ${props.at(-1)}. Each plant page shows how that sapling was propagated.`],
    [/^What are different models of plantation/,
      `We plan farms in ${models.length} models: ${models
        .slice()
        .sort((a, b) => a.sort - b.sort)
        .map((m) => `${m.name} (${m.description.split(':')[0]!.replace(/\.$/, '')})`)
        .join('; ')}. The Help me choose planner lays out any of them for your land.`],
    [/^What is the optimal spacing/,
      'It depends on the plant and the model. Each plant page lists the spacing for every model it suits, for example 18 x 18 ft for a mango in a food forest or commercial layout and 2 x 2 ft for a Miyawaki sapling.'],
    [/^Exposure required/, 'Each plant page lists the sun exposure the plant needs: full sun, partial shade or shade.'],
    [/^Rainfall required/, 'Each plant page lists the yearly rainfall range the plant grows well in, in mm. Below that range the plant needs irrigation.'],
    [/^What is the manuring procedure/,
      'Each plant page gives the compost needed at planting and then twice a year for years 1 and 2, years 3 to 6 and from year 7. The compost calculator adds this up for the plants in your cart.'],
  ];
}

/** Per-plant template answers from the plant record (FAQs tab, questions 1 and 4). */
function plantAnswer(index: number, p: ProductRecord): { answer: string | null; source: FaqRecord['source']; status: FaqRecord['status'] } {
  const plant = p.plant!;
  if (index === 1) {
    const sci = p.scientific_name ? ` (${p.scientific_name.split(' ').slice(0, 2).join(' ')})` : '';
    const prop = plant.propagation ? `, supplied as a ${PROPAGATION_TEXT[plant.propagation]} sapling` : '';
    return { answer: `This is ${p.name_en}${p.name_en.includes('(') ? '' : sci}${prop}.`, source: 'derived', status: 'approved' };
  }
  if (index === 3) {
    const v = p.variants[0]!;
    return { answer: `The sapling is dispatched at about ${v.label}.`, source: 'derived', status: 'draft' };
  }
  if (index === 4) {
    const names: Record<string, string> = { food_forest: 'food forest', miyawaki: 'Miyawaki', commercial: 'commercial', boundary: 'boundary' };
    const parts = Object.entries(plant.models)
      .filter(([, m]) => m)
      .map(([k, m]) => `${names[k]} (${Array.isArray(m!.spacing_ft) ? `${m!.spacing_ft[0]} x ${m!.spacing_ft[1]} ft` : `${m!.spacing_ft} ft apart in a line`})`);
    if (!parts.length) return { answer: null, source: 'client', status: 'needs_client' };
    return { answer: `It is planted with other trees in these layouts: ${parts.join(', ')}.`, source: 'derived', status: 'approved' };
  }
  if (index === 7) return { answer: null, source: 'ai_draft', status: 'draft' };
  // 2 permission to grow (legal), 5 yield and earnings (no earnings claims), 6 mother plant age: client only
  return { answer: null, source: 'client', status: 'needs_client' };
}

export const buildFaqs = once((): FaqRecord[] => {
  const book = workbook();
  const { products } = buildProducts();
  const bySourceRow = new Map(products.filter((p) => p.source_row).map((p) => [p.source_row!, p]));
  const agarwood = products.find((p) => p.data_source === 'woo_extra')!;
  const skusFor = (label: string): ProductRecord[] => {
    const l = cleanLine(label)!;
    if (l === 'Agarwood') return [agarwood];
    const pick = LABEL_TO_ROWS[l];
    if (!pick) throw new Error(`FAQ label "${l}" has no mapping`);
    return normalizePlants().filter(pick).map((r) => bySourceRow.get(r.source_row)!);
  };
  const out: FaqRecord[] = [];

  // General questions: columns B..D = pre-sale, pre-planting, post-planting (E, F are nursery-operation and other: not for the shop)
  const general = sheetByName(book, 'General questions');
  const answers = generalAnswers(products);
  const generalQs: string[] = [];
  for (const col of [1, 2, 3]) {
    for (const [row, cells] of [...general].sort((a, b) => a[0] - b[0])) {
      if (row === 1) continue;
      const q = cleanLine(cells[col]);
      if (q) generalQs.push(tidyQuestion(q));
    }
  }
  generalQs.forEach((q, i) => {
    const a = answers.find(([re]) => re.test(q))?.[1];
    const clientOnly = /legal|economics|investment|earn|yield|scope|different from other nurseries|other nurseries/i.test(q);
    out.push({
      key: `general-${String(i + 1).padStart(3, '0')}`,
      product_sku: null,
      question: q,
      answer: a ?? null,
      source: a ? 'derived' : clientOnly ? 'client' : 'ai_draft',
      status: a ? 'approved' : clientOnly ? 'needs_client' : 'draft',
      sort: i + 1,
    });
  });

  // FAQs tab: 7 template questions (column B) x the plants named in row 1 (from column B on)
  const faqSheet = sheetByName(book, 'FAQs');
  const header = faqSheet.get(1)!;
  const template = [...faqSheet]
    .filter(([row, c]) => row > 1 && cleanLine(c[1]))
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => tidyQuestion(String(c[1])));
  const perSku = new Map<string, { q: string; a: ReturnType<typeof plantAnswer> }[]>();
  const add = (p: ProductRecord, q: string, a: ReturnType<typeof plantAnswer>) => {
    const list = perSku.get(p.sku) ?? [];
    if (!list.some((x) => x.q === q)) list.push({ q, a });
    perSku.set(p.sku, list);
  };
  for (const label of header.slice(1)) {
    if (!cleanLine(label)) continue;
    for (const p of skusFor(String(label))) template.forEach((q, i) => add(p, q, plantAnswer(i + 1, p)));
  }
  // Nursery questions: plant names in row 1, questions below each
  const nursery = sheetByName(book, 'Nursery questions');
  const nHeader = nursery.get(1)!;
  nHeader.forEach((label, col) => {
    if (!cleanLine(label)) return;
    for (const [row, cells] of [...nursery].sort((a, b) => a[0] - b[0])) {
      const q = row > 1 ? cleanLine(cells[col]) : null;
      if (!q) continue;
      const clientOnly = /earn|buyers|export|legal|permission/i.test(q);
      for (const p of skusFor(String(label))) add(p, tidyQuestion(q), clientOnly ? { answer: null, source: 'client', status: 'needs_client' } : { answer: null, source: 'ai_draft', status: 'draft' });
    }
  });
  for (const sku of [...perSku.keys()].sort()) {
    perSku.get(sku)!.forEach(({ q, a }, i) => out.push({ key: `${sku.toLowerCase()}-q${String(i + 1).padStart(2, '0')}`, product_sku: sku, question: q, ...a, sort: i + 1 }));
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
});

export default async function step(ctx: SeedContext): Promise<void> {
  const faqs = buildFaqs();
  writeSeedFile(join(ctx.seedDir, 'faqs.json'), [SOURCES.xlsx, SOURCES.handoff], faqs, ctx);
  const n = (s: FaqRecord['status']) => faqs.filter((f) => f.status === s).length;
  ctx.log.info(`faqs: ${faqs.filter((f) => !f.product_sku).length} general, ${faqs.filter((f) => f.product_sku).length} per plant (approved ${n('approved')}, draft ${n('draft')}, needs client ${n('needs_client')})`);
}
