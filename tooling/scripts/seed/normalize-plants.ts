// Step 9.1: read the client's "Plant data" tab (159 rows) and normalise it: typo fixes (originals kept as
// search aliases), category mapping, size class, spacing parse, compost by age, climate, flags.
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { cleanLine, once, paths, readJson, ROOT } from './lib/common';
import { type Cell, readWorkbook, sheetByName, type Sheet } from './lib/xlsx';
import { join } from 'node:path';

export type SizeClass = 'L' | 'M' | 'S';
export type Canopy = 'large_tree' | 'medium_tree' | 'small_tree' | 'shrub' | 'climber';
export type Propagation = 'seeded' | 'grafted' | 'air_layered' | 'cuttings' | 'suckers' | 'tissue_culture' | 'other';
export type ModelKey = 'food_forest' | 'miyawaki' | 'commercial' | 'boundary';
export type Collection = 'timber' | 'fruiting' | 'other' | 'input';

/** One curated row from research appendix A (display name, scientific name, decided match and price). */
export interface ResearchRow {
  row: number | null;
  display: string;
  scientific: string;
  size: SizeClass;
  collection: Collection;
  subcategory: string;
  match: 'exact' | 'sibling' | 'none';
  woo_sku: string | null;
  price: number;
  bulk: number;
  bulk_min_qty: number;
  price_source: 'woo' | 'woo_sibling' | 'researched' | 'researched_native';
  models: string[];
}

export interface PlantRow {
  source_row: number;
  /** Rows 100 to 154: native / Miyawaki saplings with a scientific name in the client file. */
  is_native: boolean;
  raw_name: string;
  raw_variety: string | null;
  base_name: string;
  variety: string | null;
  name_en: string;
  name_kn: string | null;
  scientific_name: string;
  slug_base: string;
  search_aliases: string[];
  collection: Collection;
  subcategory: string;
  tags: string[];
  size_class: SizeClass;
  canopy: Canopy;
  propagation: Propagation;
  nitrogen_fixer: boolean;
  drought_tolerance: 'low' | 'moderate' | 'high';
  climate: {
    temp_c: { opt: number; min: number; max: number };
    humidity_pct: { opt: number; min: number; max: number };
    rainfall_mm: { min: number; max: number };
  };
  spacing: { food_forest: [number, number] | null; miyawaki: [number, number] | null; commercial: [number, number] | null; boundary: number | null };
  compost_kg: { at_planting: number | null; y0_2: number | null; y3_6: number | null; y7_plus: number | null; applications_per_year: 2 };
  review_notes: string[];
  research: ResearchRow;
}

/** Plant data columns (0-based, A = 0). Header spans rows 1 to 3; data starts on row 4. */
const COL = {
  name: 1, variety: 2, kannada: 3, canopy: 4, primary: 5, secondary: 6, tertiary: 7, nfix: 8, drought: 9, propagation: 10,
  tOpt: 11, tMin: 12, tMax: 13, hOpt: 14, hMin: 15, hMax: 16, rMin: 17, rMax: 18,
  ff: 19, my: 20, co: 21, bd: 22, cPlant: 23, c02: 24, c36: 25, c7: 26,
} as const;
export const FIRST_ROW = 4;
export const LAST_ROW = 162;
export const NATIVE_ROWS = { from: 100, to: 154 } as const;

/** Typos in the client's names (plan 9.1). Originals stay in `search_aliases`. */
export const TYPO_FIXES: Record<string, string> = {
  Alphonoso: 'Alphonso',
  Verigated: 'Variegated',
  Mahagony: 'Mahogany',
  Celyon: 'Ceylon',
  gratfed: 'Grafted',
  Longon: 'Longan',
  Vetiever: 'Vetiver',
  Baraba: 'Biriba',
};

const fixTypos = (s: string) => Object.entries(TYPO_FIXES).reduce((acc, [bad, good]) => acc.replace(new RegExp(`\\b${bad}\\b`, 'g'), good), s);

const CANOPY: Record<string, Canopy> = { 'large tree': 'large_tree', 'medium tree': 'medium_tree', 'small tree': 'small_tree', shrub: 'shrub', climber: 'climber', 'climber / creeper': 'climber' };
const SIZE: Record<Canopy, SizeClass> = { large_tree: 'L', medium_tree: 'M', small_tree: 'S', shrub: 'S', climber: 'S' };
const PROPAGATION: Record<string, Propagation> = {
  seeded: 'seeded', grafted: 'grafted', 'air layered': 'air_layered', cuttings: 'cuttings', suckers: 'suckers', 'tissue culture': 'tissue_culture', others: 'other',
};

/** Client primary category -> store collection and sub-collection (research section 10). */
export const CATEGORY_MAP: Record<string, { collection: Collection; subcategory: string }> = {
  'desi fruits': { collection: 'fruiting', subcategory: 'Desi' },
  'exotic fruits': { collection: 'fruiting', subcategory: 'Exotic' },
  'forest fruit': { collection: 'fruiting', subcategory: 'Forest fruit' },
  'forestry / timber': { collection: 'timber', subcategory: 'Timber' },
  spices: { collection: 'other', subcategory: 'Spices' },
  'plantation crop': { collection: 'other', subcategory: 'Plantation' },
  medicinal: { collection: 'other', subcategory: 'Native & medicinal' },
  native: { collection: 'other', subcategory: 'Native & medicinal' },
  flowering: { collection: 'other', subcategory: 'Native & medicinal' },
  biomass: { collection: 'other', subcategory: 'Biomass & support' },
  'pest repellent': { collection: 'other', subcategory: 'Biomass & support' },
  'soil binder': { collection: 'other', subcategory: 'Biomass & support' },
  pioneers: { collection: 'other', subcategory: 'Biomass & support' },
};

/** Romanised Kannada and trade names shoppers type, by base name. */
const EXTRA_ALIASES: Record<string, string[]> = {
  Mango: ['maavu', 'mavu'],
  Jackfruit: ['halasu'],
  Jamun: ['nerale', 'jambu nerale'],
  Amla: ['nellikayi', 'indian gooseberry'],
  'Sapota / Chikku': ['sapota', 'chikku', 'chickoo'],
  Coconut: ['tengu', 'thengu'],
  Banana: ['baale'],
  Arecanut: ['adike', 'supari'],
  Pepper: ['menasu', 'black pepper'],
  Sandalwood: ['shrigandha', 'chandan'],
  Teak: ['tega', 'sagwan'],
};

/** Data-quality flags the client must confirm (research section 3). Keyed by sheet row. */
const ROW_FLAGS: Record<number, string> = {
  5: 'Propagation: client says Seeded, figs are normally cuttings or air layers (old shop said grafted); confirm.',
  37: 'Kannada name repeats the jackfruit word; confirm the Monkey Jack name.',
  63: '"Baraba" read as Biriba (Rollinia deliciosa); confirm the identity.',
  66: 'Kannada name missing.',
  77: 'Kannada name missing.',
  135: 'Melia dubia is mainly a commercial timber crop but has Miyawaki-only spacing; confirm commercial spacing.',
  161: 'Tertiary category "Desi fruits" looks wrong for Mexican sunflower; dropped from tags, confirm.',
};

const str = (c: Cell | undefined): string | null => (c === null || c === undefined ? null : cleanLine(c));
const num = (c: Cell | undefined): number | null => {
  if (typeof c === 'number') return c;
  const s = str(c);
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "18 x 18" -> [18, 18]; "-" or blank -> null. */
export function parseSpacing(c: Cell | undefined): [number, number] | null {
  const s = str(c);
  if (!s || s === '-') return null;
  const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(s);
  if (!m) throw new Error(`unparseable spacing "${s}"`);
  return [Number(m[1]), Number(m[2])];
}

/** Binomial (plus "var. x") without the author citation: "Aegle marmelos (L.) Corrêa" -> "Aegle marmelos". */
export function binomial(scientific: string): string {
  const words = scientific.replace(/\(.*?\)/g, ' ').replace(/\?/g, '').trim().split(/\s+/);
  const out = words.slice(0, 2);
  const v = words.indexOf('var.');
  if (v > -1 && words[v + 1]) out.push('var.', words[v + 1]!);
  return out.join(' ');
}

const tagOf = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export const researchRows = once(() => readJson<ResearchRow[]>(join(ROOT, 'tooling', 'scripts', 'seed', 'data', 'research-rows.json')));

export const workbook = once(() => readWorkbook(paths.xlsx()));
export const plantSheet = once((): Sheet => sheetByName(workbook(), 'Plant data'));

export const normalizePlants = once((): PlantRow[] => {
  const sheet = plantSheet();
  const research = new Map(researchRows().filter((r) => r.row !== null).map((r) => [r.row!, r]));
  const out: PlantRow[] = [];
  for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
    const c = sheet.get(row);
    const rawName = c ? str(c[COL.name]) : null;
    if (!c || !rawName) throw new Error(`Plant data row ${row} is empty; expected 159 rows from ${FIRST_ROW} to ${LAST_ROW}`);
    const r = research.get(row);
    if (!r) throw new Error(`research-rows.json has no row ${row}`);
    const notes: string[] = [];
    const isNative = row >= NATIVE_ROWS.from && row <= NATIVE_ROWS.to;
    const rawVariety = str(c[COL.variety]);
    let baseName = fixTypos(rawName);
    const variety = rawVariety ? fixTypos(rawVariety) : null;

    const canopyRaw = (str(c[COL.canopy]) ?? '').toLowerCase();
    const canopy = CANOPY[canopyRaw];
    if (!canopy) throw new Error(`row ${row}: unknown canopy "${canopyRaw}"`);
    const propRaw = (str(c[COL.propagation]) ?? '').toLowerCase();
    const propagation = PROPAGATION[propRaw];
    if (!propagation) throw new Error(`row ${row}: unknown propagation "${propRaw}"`);
    const drought = (str(c[COL.drought]) ?? '').toLowerCase() as PlantRow['drought_tolerance'];
    if (!['low', 'moderate', 'high'].includes(drought)) throw new Error(`row ${row}: unknown drought tolerance "${drought}"`);

    const primary = (str(c[COL.primary]) ?? '').toLowerCase();
    const mapped = CATEGORY_MAP[primary];
    if (!mapped) throw new Error(`row ${row}: unknown primary category "${primary}"`);
    const categories = [c[COL.primary], c[COL.secondary], c[COL.tertiary]].map(str).filter((x): x is string => !!x);
    const tags = categories
      .filter((cat) => !(row === 161 && cat.toLowerCase() === 'desi fruits'))
      .map(tagOf);
    const nitrogenFixer = (str(c[COL.nfix]) ?? '').toLowerCase() === 'yes';
    if (nitrogenFixer) tags.push('nitrogen_fixer');
    if (drought === 'high') tags.push('drought_tolerant');

    const kannada = str(c[COL.kannada]);
    const scientific = isNative ? rawName : r.scientific.replace(/\s*\(.*\)\??$/, '').replace(/\?$/, '');
    let nameEn: string;
    let slugBase: string;
    const aliases = new Set<string>();
    if (isNative) {
      // "Ankola (Sage-leaved Alangium)" -> "Ankola (Alangium salviifolium)"; the English name stays searchable
      let alt: string | null = null;
      let common = r.display.replace(/\s*\((.*?)\)\s*$/, (_, a: string) => {
        alt = a;
        return '';
      });
      // "Melia Dubia (Malabar Neem)": the common part is the binomial itself, so the English name leads
      if (alt && common.toLowerCase() === binomial(scientific).toLowerCase()) [common, alt] = [alt, common];
      if (alt) aliases.add(alt);
      nameEn = `${common} (${binomial(scientific)})`;
      baseName = common;
      slugBase = `${common.replace(/^Native\s+/i, '')} native sapling`;
    } else {
      nameEn = row === 63 ? 'Biriba' : r.display;
      slugBase = nameEn;
    }

    const rawFull = [rawName, rawVariety].filter(Boolean).join(' ');
    const fixedFull = [baseName, variety].filter(Boolean).join(' ');
    if (rawFull !== fixedFull) aliases.add(rawFull);
    if (row === 63) aliases.add('Baraba');
    if (isNative) aliases.add(binomial(scientific));
    if (kannada) aliases.add(kannada);
    for (const a of EXTRA_ALIASES[baseName] ?? []) aliases.add(a);
    aliases.delete(nameEn);

    if (ROW_FLAGS[row]) notes.push(ROW_FLAGS[row]!);
    if (!kannada && !ROW_FLAGS[row]) notes.push('Kannada name missing.');

    const compost = (col: number) => num(c[col]);
    const boundary = num(c[COL.bd]);
    if (c[COL.bd] === null) notes.push('Boundary spacing blank, treated as "-".');

    const tOpt = num(c[COL.tOpt]);
    const tMin = num(c[COL.tMin]);
    const tMax = num(c[COL.tMax]);
    const hOpt = num(c[COL.hOpt]);
    const hMin = num(c[COL.hMin]);
    const hMax = num(c[COL.hMax]);
    const rMin = num(c[COL.rMin]);
    const rMax = num(c[COL.rMax]);
    if ([tOpt, tMin, tMax, hOpt, hMin, hMax, rMin, rMax].some((v) => v === null)) throw new Error(`row ${row}: climate incomplete`);

    const y3 = compost(COL.c36);
    const y7 = compost(COL.c7);
    if (y3 === null) notes.push('Compost for 3 to 6 years is "-"; assumed none, confirm.');

    out.push({
      source_row: row,
      is_native: isNative,
      raw_name: rawName,
      raw_variety: rawVariety,
      base_name: baseName,
      variety,
      name_en: nameEn,
      name_kn: kannada,
      scientific_name: scientific,
      slug_base: slugBase,
      search_aliases: [...aliases].sort(),
      collection: mapped.collection,
      subcategory: mapped.subcategory,
      tags: [...new Set(tags)],
      size_class: SIZE[canopy],
      canopy,
      propagation,
      nitrogen_fixer: nitrogenFixer,
      drought_tolerance: drought,
      climate: {
        temp_c: { opt: tOpt!, min: tMin!, max: tMax! },
        humidity_pct: { opt: hOpt!, min: hMin!, max: hMax! },
        rainfall_mm: { min: rMin!, max: rMax! },
      },
      spacing: { food_forest: parseSpacing(c[COL.ff]), miyawaki: parseSpacing(c[COL.my]), commercial: parseSpacing(c[COL.co]), boundary },
      compost_kg: { at_planting: compost(COL.cPlant), y0_2: compost(COL.c02), y3_6: y3, y7_plus: y7, applications_per_year: 2 },
      review_notes: notes,
      research: r,
    });
  }
  return out;
});

export default async function step(ctx: SeedContext): Promise<void> {
  const rows = normalizePlants();
  ctx.log.info(`normalize-plants: ${rows.length} rows, ${rows.filter((r) => r.is_native).length} native, ${rows.filter((r) => r.review_notes.length).length} with notes`);
}
