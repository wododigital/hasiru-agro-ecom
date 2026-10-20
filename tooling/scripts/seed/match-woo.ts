// Step 9.2: match the 159 client rows against the 193 old Woo plants. Token Jaccard + variety bonus +
// string similarity over an alias map, with two hard rules: the base species must match, and the
// scientific (native) rows are never matched. Hand decisions from the research review are pinned below.
// @boundaries-ignore type-only: the seed-hook contract; @tooling/scripts cannot depend on core (core depends on it for db helpers)
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { cleanLine, once, paths, readJson } from './lib/common';
import { normalizePlants, type PlantRow, type Propagation } from './normalize-plants';

export interface WooRow {
  ID: string;
  Type: string;
  SKU: string;
  Name: string;
  'Is featured?': string;
  'Short description': string;
  Description: string;
  Stock: string;
  'Sale price': string;
  'Regular price': string;
  Categories: string;
  Images: string;
  'Meta: offlineprice': string;
  'Meta: type': string;
  'Meta: growth-habit': string;
  'Meta: spacing': string;
  'Meta: fruit-shape': string;
  'Meta: harvesting-season': string;
  'Meta: yield-per-tree': string;
  'Meta: bearing-time': string;
  'Meta: exposure': string;
  'Meta: temperature': string;
  'Meta: fruit-size': string;
  'Meta: intercropping': string;
  'Meta: soiltype': string;
  'Meta: rank_math_title': string;
  'Meta: rank_math_description': string;
  'Meta: rank_math_focus_keyword': string;
  'Meta: _yoast_wpseo_focuskw': string;
  'Meta: _yoast_wpseo_metadesc': string;
  [key: string]: string;
}

export type MatchKind = 'exact' | 'sibling' | 'none';
export interface Match {
  kind: MatchKind;
  woo_sku: string | null;
  confidence: number;
  /** What the scoring alone decided, before any pin (for the review CSV). */
  suggested: { kind: MatchKind; woo_sku: string | null; confidence: number };
  pinned: string | null;
}

/** The e-book (virtual) is dropped; every other Woo row is a plant. */
export const wooPlants = once(() => readJson<WooRow[]>(paths.wooProducts()).filter((r) => !r.Type.includes('virtual')));
export const wooBySku = once(() => new Map(wooPlants().map((r) => [r.SKU, r])));

/** Woo rows that are the larger size of a matched product: seeded as a second variant, not a product. */
export const SIZE_VARIANTS: Record<string, { parent: string; label: string; height_ft: number }> = {
  HA0098: { parent: 'HA0097', label: '6 ft', height_ft: 6 },
  HA00128: { parent: 'HA00127', label: '8 ft', height_ft: 8 },
};
export const SIZE_VARIANT_DEFAULT_LABEL: Record<string, { label: string; height_ft: number }> = {
  HA0097: { label: '1.5 ft', height_ft: 1.5 },
  HA00127: { label: '3 ft', height_ft: 3 },
};
/** Listed by the client (Plant list, FAQs) but missing from Plant data: imported from Woo as an active product. */
export const AGARWOOD_SKU = 'HA005';

/** Spelling variants and trade names, applied token-wise before scoring. */
const TOKEN_ALIASES: Record<string, string> = {
  alphonoso: 'alphonso', mahagony: 'mahogany', tirthalli: 'thirthahalli', bagwa: 'bhagwa', ana: 'anna',
  longon: 'longan', verigated: 'variegated', varigated: 'variegated', varigatd: 'variegated', celyon: 'ceylon',
  gratfed: 'grafted', gafted: 'grafted', haas: 'hass', chickoo: 'chikku', sapota: 'chikku', musambi: 'mosumbi',
  mosumbie: 'mosumbi', lakshmanphal: 'soursop', chakota: 'pomelo', honge: 'pongamia', kaju: 'cashew',
  cashewnut: 'cashew', dragonfruit: 'dragon fruit', spices: 'spice', allspice: 'all spice', areca: 'arecanut',
  amate: 'amatekai', persimon: 'persimmon', breadfruit: 'bread fruit', vetiever: 'vetiver',
};

/** Species phrases (after aliasing). The species of a name is the phrase ending last in it, longest on a tie. */
const SPECIES: Record<string, string[]> = {
  amla: ['amla'], fig: ['anjeer', 'fig'], apple: ['apple'], custard_apple: ['custard apple'], ber: ['ber', 'bore hannu'],
  arecanut: ['arecanut'], cashew: ['cashew'], chikku: ['chikku', 'banana chikku'], coconut: ['coconut'], guava: ['guava'],
  hog_plum: ['hog plum', 'amatekai', 'indian olive'], jackfruit: ['jackfruit'], jamun: ['jamun'], karonda: ['karonda'],
  lemon: ['lemon', 'lime'], mango: ['mango'], monkey_jack: ['monkey jack'], mosumbi: ['mosumbi'], litchi: ['litchi'],
  orange: ['orange'], nutmeg: ['nutmeg'], papaya: ['papaya'], peanut_butter: ['peanut butter'], pepper: ['pepper'],
  pomelo: ['pomelo'], pomegranate: ['pomegranate'], rose_apple: ['rose apple', 'rose water apple', 'panneralu'],
  soursop: ['soursop'], starfruit: ['starfruit'], tamarind: ['tamarind'], water_apple: ['water apple'],
  wild_jack: ['hebbalasu'], wood_apple: ['wood apple'], banana: ['banana'], abiu: ['abiu'], achachiru: ['achachiru'],
  avocado: ['avocado'], biriba: ['biriba', 'baraba'], bread_fruit: ['bread fruit'], dragon_fruit: ['dragon fruit'],
  egg_fruit: ['egg fruit'], ice_cream_bean: ['ice cream beans'], jaboticaba: ['jaboticaba'], longan: ['longan'],
  macadamia: ['macadamia'], mangosteen: ['mangosteen'], matoa: ['matoa'], milk_fruit: ['milk fruit', 'star apple'],
  miracle_fruit: ['miracle fruit'], olive: ['olive'], passion_fruit: ['passion fruit'], rain_forest_plum: ['rain forest plum'],
  rambutan: ['rambutan'], salak: ['salak'], velvet_apple: ['velvet apple'], allspice: ['all spice'], cardamom: ['cardamom'],
  cinnamon: ['cinnamon'], clove: ['clove'], curry_leaf: ['curry leaves'], bamboo: ['bamboo'], mahogany: ['mahogany'],
  neem: ['neem'], pongamia: ['pongamia'], red_sandal: ['red sandal', 'red sandalwood'], sandalwood: ['sandalwood'],
  soapnut: ['soapnut', 'antwala'], teak: ['teak'], sesbania: ['sesbania'], gliricidia: ['gliricidia'], moringa: ['moringa'],
  lemongrass: ['lemongrass'], vetiver: ['vetiver'], marigold: ['marigold'], mexican_sunflower: ['mexican sunflower'],
  mulberry: ['mulberry'], agarwood: ['agarwood'],
};

/** Words that never distinguish a variety. */
const STOP = new Set([
  'plant', 'plants', 'tree', 'trees', 'sapling', 'saplings', 'grafted', 'seeded', 'air', 'layered', 'rooted', 'sweet',
  'japanese', 'australian', 'thai', 'variety', 'nut', 'nuts', 'the', 'of', 'and', 'jumbo', 'chandan', 'pinnata',
]);

const PHRASES = Object.entries(SPECIES).flatMap(([id, ps]) => ps.map((p) => ({ id, words: p.split(' ') })));
const SPECIES_WORDS = new Map(Object.entries(SPECIES).map(([id, ps]) => [id, new Set(ps.flatMap((p) => p.split(' ')))]));

export function tokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\d+(?:\.\d+)?\s*ft\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .flatMap((t) => (TOKEN_ALIASES[t] ?? t).split(' '))
    .filter(Boolean);
}

/** Species id of a token list (the phrase ending last, longest on a tie). */
export function species(toks: string[]): string | null {
  let best: { id: string; end: number; len: number } | null = null;
  for (const { id, words } of PHRASES) {
    for (let i = 0; i + words.length <= toks.length; i++) {
      if (words.every((w, j) => toks[i + j] === w)) {
        const end = i + words.length;
        if (!best || end > best.end || (end === best.end && words.length > best.len)) best = { id, end, len: words.length };
      }
    }
  }
  return best?.id ?? null;
}

/** Words that name the variety: everything except the species' own words and stop words. */
const varietyTokens = (toks: string[], sp: string) => new Set(toks.filter((t) => !SPECIES_WORDS.get(sp)?.has(t) && !STOP.has(t)));

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Dice coefficient over character bigrams (stands in for a sequence-matcher ratio). */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(1, a.length - 1) + Math.max(1, b.length - 1);
  return (2 * inter) / total;
}

const WOO_PROPAGATION: Record<string, Propagation> = {
  seeded: 'seeded', grafted: 'grafted', gafted: 'grafted', 'air layered': 'air_layered', 'stem cuttings': 'cuttings', rooted: 'cuttings',
  'root suckers': 'suckers',
};
export const wooPropagation = (w: WooRow): Propagation | null => WOO_PROPAGATION[(cleanLine(w['Meta: type']) ?? '').toLowerCase()] ?? null;

export const AUTO_ACCEPT = 0.55;

/**
 * Score one client row against the Woo plants. Candidates share the species (hard rule). Exact = the
 * variety words agree (Jaccard >= 0.5), score >= AUTO_ACCEPT and the propagation does not conflict;
 * otherwise the best candidate is a sibling; no candidate = none. Ties prefer matching propagation.
 */
export function suggestMatch(p: Pick<PlantRow, 'base_name' | 'variety' | 'propagation' | 'is_native'>, woo: WooRow[]): Match['suggested'] {
  if (p.is_native) return { kind: 'none', woo_sku: null, confidence: 1 }; // hard rule: native rows are their own line
  const cName = [p.variety, p.base_name].filter(Boolean).join(' ');
  const cTok = tokens(cName);
  const cSp = species(cTok);
  if (!cSp) return { kind: 'none', woo_sku: null, confidence: 0 };
  const cVar = varietyTokens(cTok, cSp);
  const cCore = new Set([cSp, ...cVar]);
  let bestExact: { w: WooRow; score: number } | null = null;
  let bestAny: { w: WooRow; score: number } | null = null;
  for (const w of woo) {
    const wTok = tokens(w.Name);
    if (species(wTok) !== cSp) continue;
    const wVar = varietyTokens(wTok, cSp);
    const wProp = wooPropagation(w);
    let score = jaccard(cCore, new Set([cSp, ...wVar])) + 0.2 * similarity(cName.toLowerCase(), w.Name.toLowerCase());
    if (cVar.size && [...cVar].every((t) => wVar.has(t))) score += 0.3;
    if (cVar.size && ![...cVar].some((t) => wVar.has(t))) score -= 0.5;
    if (wProp === p.propagation) score += 0.05;
    if (!bestAny || score > bestAny.score) bestAny = { w, score };
    const exact = jaccard(cVar, wVar) >= 0.5 && score >= AUTO_ACCEPT;
    if (exact && (!bestExact || score > bestExact.score)) bestExact = { w, score };
  }
  const pick = bestExact ?? bestAny;
  if (!pick) return { kind: 'none', woo_sku: null, confidence: 0 };
  return { kind: bestExact ? 'exact' : 'sibling', woo_sku: pick.w.SKU, confidence: Math.round(Math.min(1, Math.max(0, pick.score)) * 100) / 100 };
}

/**
 * Hand decisions from the research review (research section 4), applied over the scoring. Each pin names
 * why. A pin that agrees with the scoring is dropped by the self-check, so this list only holds overrides.
 */
export const PINS: Record<number, { kind: MatchKind; woo_sku: string | null; why: string }> = {
  11: { kind: 'none', woo_sku: null, why: '"Kaju badam" is not a cashew sapling listing; researched price' },
  14: { kind: 'none', woo_sku: null, why: 'Only tall coconuts in the old shop; a dwarf is priced from research' },
  23: { kind: 'exact', woo_sku: 'HA00174', why: 'Vietnam super early = "Vietnam Jackfruit All season Grafted" (same plant, file named Vietnam-super-early)' },
  24: { kind: 'none', woo_sku: null, why: 'Seeded desi jamun; the old shop only had grafted cultivars' },
  28: { kind: 'sibling', woo_sku: 'HA00161', why: 'Thai seedless lime is a lime, used for price only' },
  35: { kind: 'sibling', woo_sku: 'HA00166', why: 'Sakkaregutli priced like Totapuri (closest desi cultivar)' },
  47: { kind: 'sibling', woo_sku: 'HA00157', why: 'Old shop sold named pomelo cultivars; the client row is the generic pomelo' },
  72: { kind: 'sibling', woo_sku: 'HA0091', why: 'Old shop listing is the seeded macadamia; the grafted row borrows its price (grafted likely higher)' },
  89: { kind: 'exact', woo_sku: 'HA0049', why: 'Old shop "Cinnamon" is the Ceylon cinnamon' },
  94: { kind: 'sibling', woo_sku: 'HA0073', why: 'No neem in the old shop; priced like Honge (native tree in a bag)' },
  98: { kind: 'sibling', woo_sku: 'HA0073', why: 'No soapnut in the old shop; priced like Honge (native tree in a bag)' },
};

export const matchPlants = once((): Map<number, Match> => {
  const woo = wooPlants().filter((w) => !(w.SKU in SIZE_VARIANTS) && w.SKU !== AGARWOOD_SKU);
  const out = new Map<number, Match>();
  for (const p of normalizePlants()) {
    const suggested = suggestMatch(p, woo);
    const pin = PINS[p.source_row];
    out.set(p.source_row, {
      kind: pin?.kind ?? suggested.kind,
      woo_sku: pin ? pin.woo_sku : suggested.woo_sku,
      confidence: pin ? 1 : suggested.confidence,
      suggested,
      pinned: pin?.why ?? null,
    });
  }
  return out;
});

export default async function step(ctx: SeedContext): Promise<void> {
  const m = [...matchPlants().values()];
  const count = (k: MatchKind) => m.filter((x) => x.kind === k).length;
  ctx.log.info(`match-woo: exact ${count('exact')}, sibling ${count('sibling')}, none ${count('none')} (pins ${m.filter((x) => x.pinned).length})`);
}
