import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  chunkText,
  factsMessage,
  fixDashes,
  hasSubstance,
  listDecision,
  notesFor,
  parseAnswer,
  parseQuestion,
  qtyForArea,
  rankProducts,
  readFactsMessage,
  resolveRefs,
  selectCandidates,
  systemPrompt,
  templateNarration,
  toModelFacts,
  validateNarration,
  type CatalogItem,
  type Facts,
  type ProductFact,
} from '../src/domain';
import { assistantMessages as m } from '../src/messages';

const lex = m.lexicon;

const item = (o: Partial<CatalogItem> & { id: string; name: string }): CatalogItem => ({
  slug: o.name.toLowerCase().replace(/\s+/g, '-'),
  href: `/plant/${o.id}`,
  kind: 'plant',
  nameKn: null,
  groups: [],
  collectionLine: null,
  exposure: 'full_sun',
  bearingYearsMin: null,
  bearingYearsMax: null,
  nitrogenFixer: false,
  isBestSeller: false,
  variantId: `v-${o.id}`,
  climate: null,
  status: 'active',
  availabilityOverride: null,
  ...o,
});

const CATALOG: CatalogItem[] = [
  item({ id: 'a', name: 'Alpha Mango', groups: ['Fruiting Trees', 'Desi', 'fruiting', 'desi'], bearingYearsMin: 3, bearingYearsMax: 4, isBestSeller: true }),
  item({ id: 'b', name: 'Beta Guava', groups: ['Fruiting Trees', 'Exotic', 'fruiting', 'exotic'], exposure: 'partial_shade', bearingYearsMin: 2, bearingYearsMax: 3 }),
  item({ id: 'c', name: 'Teak', groups: ['Timber Trees', 'Timber', 'timber'] }),
  item({ id: 'd', name: 'Gamma Coffee', groups: ['Other Plants', 'Plantation'], exposure: 'shade' }),
  item({ id: 'e', name: 'Delta Gliricidia', groups: ['Other Plants', 'Biomass support'], nitrogenFixer: true }),
  item({ id: 'h', name: 'Hidden Plum', status: 'draft' }),
];

const fact = (o: Partial<ProductFact> & { id: string; name: string }): ProductFact => ({
  href: `/plant/${o.id}`,
  variantId: `v-${o.id}`,
  collectionLine: null,
  unitPaise: 45_000,
  bulk: { minQty: 50, unitPaise: 35_500 },
  stock: 'in_stock',
  bearingYears: null,
  shade: false,
  nitrogenFixer: false,
  fit: null,
  areaQty: null,
  ...o,
});

describe('intent parser', () => {
  it('finds intents, price caps, bearing years, acres and place words from the lexicon', () => {
    const q = parseQuestion('Fruit trees under Rs 400 that bear in 2 years', lex);
    expect(q.intents).toEqual(expect.arrayContaining(['price', 'bearing']));
    expect(q.maxPricePaise).toBe(40_000);
    expect(q.bearingWithinYears).toBe(2);
    expect(q.terms).toContain('tree');

    const a = parseQuestion('Best timber trees for a 2 acre farm', lex);
    expect(a.acres).toBe(2);
    expect(a.intents).toContain('acreage');
    expect(a.terms).toEqual(expect.arrayContaining(['timber', 'tree']));

    expect(parseQuestion('What grows in Mysuru', lex).placeQuery).toBe('mysuru');
    expect(parseQuestion('What can I grow in partial shade?', lex).intents).toContain('shade');
    expect(parseQuestion('How does bulk pricing work?', lex).intents).toEqual(['bulk']);
    expect(parseQuestion('₹350 or less, under ₹1,250 please', lex).maxPricePaise).toBe(125_000);
    expect(parseQuestion('tell me a joke', lex).intents).toEqual(['offTopic']);
    // A bare number after "within" is a price only when no unit follows it.
    expect(parseQuestion('fruit within 2 years', lex)).toMatchObject({ maxPricePaise: null, bearingWithinYears: 2 });
    expect(parseQuestion('fruit within 20 years', lex).maxPricePaise).toBeNull();
    expect(parseQuestion('anything below 500?', lex).maxPricePaise).toBe(50_000);
    expect(parseQuestion('What grows well with mango?', lex)).toMatchObject({ intents: ['companions'], terms: ['mango'] });
    expect(parseQuestion('hello', lex).intents).toEqual(['greeting']);
    expect(parseQuestion('Which mangoes are in stock?', lex).terms).toContain('mango');
  });
});

describe('rules engine', () => {
  it('keeps only the best-matching tier: names beat categories, hidden rows never appear', () => {
    const mango = selectCandidates(parseQuestion('mango trees', lex), CATALOG);
    expect(mango.best).toBe(2);
    expect(mango.candidates.map((c) => c.item.id)).toEqual(['a']);
    const timber = selectCandidates(parseQuestion('timber trees', lex), CATALOG);
    expect(timber.candidates.map((c) => c.item.id)).toEqual(['c']);
    const exotic = selectCandidates(parseQuestion('exotic fruits', lex), CATALOG);
    expect(exotic.candidates.map((c) => c.item.id)).toEqual(['b']);
    expect(selectCandidates(parseQuestion('plum', lex), CATALOG).best).toBe(0);
  });

  it('applies attribute filters: shade, nitrogen, bearing within N years', () => {
    expect(selectCandidates(parseQuestion('what grows in shade', lex), CATALOG).candidates.map((c) => c.item.id).sort()).toEqual(['b', 'd']);
    expect(selectCandidates(parseQuestion('which fix nitrogen', lex), CATALOG).candidates.map((c) => c.item.id)).toEqual(['e']);
    expect(selectCandidates(parseQuestion('what fruits within 2 years', lex), CATALOG).candidates.map((c) => c.item.id)).toEqual(['b']);
  });

  it('decides between a list, a policy note and "no match"', () => {
    const d = (s: string) => {
      const q = parseQuestion(s, lex);
      return listDecision(q, selectCandidates(q, CATALOG).best);
    };
    expect(d('How does bulk pricing work?')).toEqual({ list: false, noMatch: false });
    expect(d('Do you have dragonfruit?')).toEqual({ list: false, noMatch: true });
    expect(d('Which items are in stock?')).toEqual({ list: true, noMatch: false });
    expect(d('What grows in shade?')).toEqual({ list: true, noMatch: false });
    expect(d('tell me a joke')).toEqual({ list: false, noMatch: false });
    expect(notesFor(parseQuestion('tell me a joke', lex), { products: 0, noMatch: false, companionsMissing: false })).toEqual(['offTopic']);
    expect(notesFor(parseQuestion('bulk rates and delivery?', lex), { products: 0, noMatch: false, companionsMissing: false })).toEqual(['bulk', 'delivery']);
  });

  it('ranks in stock first, drops items over the price cap or out of stock when stock is asked', () => {
    const products = [fact({ id: 'x', name: 'X', stock: 'out_of_stock' }), fact({ id: 'y', name: 'Y', unitPaise: 90_000, bulk: null }), fact({ id: 'z', name: 'Z' })];
    const w = new Map([['x', 5]]);
    expect(rankProducts(parseQuestion('anything', lex), products, w).map((p) => p.id)).toEqual(['y', 'z', 'x']);
    expect(rankProducts(parseQuestion('under Rs 400', lex), products, w).map((p) => p.id)).toEqual(['z', 'x']);
    expect(rankProducts(parseQuestion('in stock under Rs 400', lex), products, w).map((p) => p.id)).toEqual(['z']);
  });

  it('sizes an order for an area from the spacing', () => {
    expect(qtyForArea(1, [9, 9])).toBe(538);
    expect(qtyForArea(1, [10, 10])).toBe(436);
    expect(qtyForArea(2, 18)).toBe(269);
    expect(qtyForArea(1, [0, 9])).toBeNull();
  });
});

const FACTS: Facts = {
  mode: 'shop',
  question: 'Which mango is in stock?',
  intents: ['stock'],
  products: [fact({ id: 'id-a', name: 'Alpha Mango', bearingYears: { min: 3, max: 4 } }), fact({ id: 'id-b', name: 'Beta Guava', unitPaise: 32_000, bulk: null, stock: 'preorder' })],
  notes: ['bulk'],
  district: null,
  companionOf: null,
  acres: null,
};

describe('narrator view, template and validator', () => {
  const { view, refs } = toModelFacts(FACTS, m);

  it('formats every number for the narrator and hides ids behind refs', () => {
    expect(view.products.map((p) => p.ref)).toEqual(['p1', 'p2']);
    expect(view.products[0]).toMatchObject({ price: 'Rs 450 each', bulk: 'Rs 355 each from 50', stock: 'in stock', traits: ['bears in about 3 to 4 years'] });
    expect(JSON.stringify(view)).not.toContain('id-a');
    expect(refs.get('p1')).toBe('id-a');
    expect(readFactsMessage(factsMessage(view))).toEqual(view);
  });

  it('template answers pass the validator untouched and resolve refs to ids', () => {
    const t = templateNarration(view, m.suggestions.shop);
    const checked = validateNarration(t, view, m.countWords);
    expect(checked.droppedRefs).toEqual([]);
    expect(checked.droppedSentences).toEqual([]);
    expect(checked.narration.answer).toBe(t.answer);
    const resolved = resolveRefs(checked.narration, refs);
    expect(resolved.answer).toContain('[[id-a]]');
    expect(resolved.productIds).toEqual(['id-a', 'id-b']);
  });

  it('drops unknown product refs, invented prices and counts; keeps grounded sentences', () => {
    const out = validateNarration(
      {
        answer: 'Try [[p1]] at Rs 450 each. Also [[p9]] is great.\n- [[p2]]: Rs 320 each.\n- [[p3]]: only Rs 99 today.\nBuy 120 saplings for Rs 30,000. Bulk is Rs 355 each from 50.',
        productIds: ['p1', 'p7', 'P2'],
        followUps: ['Is it Rs 5 cheaper?', 'Which ones grow fast?', '[[p1]] more?'],
      },
      view,
      m.countWords,
    );
    expect(out.droppedRefs).toEqual(expect.arrayContaining(['p9']));
    expect(out.droppedSentences).toEqual(expect.arrayContaining(['[[p3]]: only Rs 99 today.', 'Buy 120 saplings for Rs 30,000.']));
    // A digit inside a ref ("p1") never makes "Rs 1" look grounded.
    expect(validateNarration({ answer: 'Now Rs 1 each.', productIds: [], followUps: [] }, view, m.countWords).droppedSentences).toEqual(['Now Rs 1 each.']);
    expect(out.narration.answer).toContain('[[p1]] at Rs 450 each.');
    expect(out.narration.answer).toContain('Rs 355 each from 50');
    expect(out.narration.answer).not.toContain('p9');
    expect(out.narration.answer).not.toContain('Rs 99');
    expect(out.narration.productIds).toEqual(['p1', 'p2']);
    expect(out.narration.followUps).toEqual(['Which ones grow fast?']);
  });

  it('accepts amounts spelled with or without grouping and rejects a count the facts never gave', () => {
    const v = { ...view, question: 'how many for 2 acres', products: [{ ...view.products[0]!, area: 'about 1,076 for 2 acres at 9 x 9 ft spacing' }] };
    expect(allowedNumbers(v).has('1076')).toBe(true);
    expect(validateNarration({ answer: 'You need about 1076 plants.', productIds: [], followUps: [] }, v, m.countWords).droppedSentences).toEqual([]);
    expect(validateNarration({ answer: 'You need about 1100 plants.', productIds: [], followUps: [] }, v, m.countWords).droppedSentences).toHaveLength(1);
  });

  it('rewrites em and en dashes, flattens headings', () => {
    expect(fixDashes('Mango \u2014 sweet, 3\u20134 years')).toBe('Mango, sweet, 3 to 4 years');
    const out = validateNarration({ answer: '## Picks\n[[p1]] \u2014 in stock.', productIds: [], followUps: [] }, view, m.countWords);
    expect(out.narration.answer).toBe('Picks\n[[p1]], in stock.');
    expect(hasSubstance({ answer: '', productIds: [], followUps: [] })).toBe(false);
    expect(hasSubstance(out.narration)).toBe(true);
  });
});

describe('copy rules', () => {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(m);

  it('no em dashes, en dashes or version words in any template, message or the system prompt', () => {
    const { view } = toModelFacts(FACTS, m);
    const template = templateNarration(view, m.suggestions.shop);
    for (const s of [...strings, systemPrompt('A store.'), template.answer, ...template.followUps]) {
      expect(s, s).not.toMatch(/[\u2014\u2013]/);
      expect(s, s).not.toMatch(/\b(phase|v1|v2)\b/i);
    }
  });

  it('templates cover every note key and every mode has six suggestions', () => {
    for (const k of ['bulk', 'delivery', 'returns', 'noMatch', 'offTopic', 'greeting', 'acreage', 'companionsUnavailable'] as const) expect(m.answers[k]).toBeTruthy();
    for (const mode of ['shop', 'plan', 'farm'] as const) expect(m.suggestions[mode]).toHaveLength(6);
  });
});

describe('markdown-lite and streaming chunks', () => {
  it('parses paragraphs, bullets, bold and product tokens', () => {
    expect(parseAnswer('Lead **bold** text\n\n- [[id-a]]: Rs 450\n- two\n\nEnd')).toEqual([
      { kind: 'p', parts: [{ kind: 'text', text: 'Lead ' }, { kind: 'bold', text: 'bold' }, { kind: 'text', text: ' text' }] },
      { kind: 'ul', items: [[{ kind: 'product', id: 'id-a' }, { kind: 'text', text: ': Rs 450' }], [{ kind: 'text', text: 'two' }]] },
      { kind: 'p', parts: [{ kind: 'text', text: 'End' }] },
    ]);
  });

  it('chunks rejoin to the exact answer', () => {
    const text = 'Here is what I found:\n\n- [[a]]: Rs 450 each, in stock.\n- [[b]]: pre-order.';
    expect(chunkText(text).join('')).toBe(text);
    expect(chunkText(text).length).toBeGreaterThan(2);
  });
});
