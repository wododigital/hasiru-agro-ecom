import type { Canopy, Level, Propagation, SizeClass } from './enums';

/**
 * The grower's "Plant data" sheet layout (27 columns, three header rows, agronomy only; prices live in pricing).
 * Import reads it, export writes it, so a sheet can round-trip through the admin.
 */
export const SHEET_NAME = 'Plant data';
export const SHEET_HEADER: readonly (readonly (string | null)[])[] = [
  ['Sl No', 'Plant name', 'Variety', 'Kannada name', 'Canopy size', 'Primary category', 'Secondary category', 'Tertiary category', 'Nitrogen fixer (Yes/No)', 'Drought tolerant', 'Propagation method', 'Temperature', null, null, 'Humidity', null, null, 'Water', null, 'Models spacing (sqft)', null, null, null, 'Compost requirement (Kg)', null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, 'Opt', 'Min', 'Max', 'Opt', 'Min', 'Max', 'Rainfall mm/y', null, 'Food forest', 'Miyawaki', 'Commercial', 'Boundary', 'During planting', '0-2 years (twice a year)', '3-6 years (twice a year)', '7 and above (twice a year)'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'Min', 'Max', null, null, null, null, null, null, null, null],
];
export const SHEET_DATA_START = 3;
/** Merged header cells (r = row, c = column, 0-based) so the exported sheet looks like the source. */
export const SHEET_MERGES = [
  ...Array.from({ length: 11 }, (_, c) => ({ s: { r: 0, c }, e: { r: 2, c } })),
  { s: { r: 0, c: 11 }, e: { r: 0, c: 13 } },
  { s: { r: 0, c: 14 }, e: { r: 0, c: 16 } },
  { s: { r: 0, c: 17 }, e: { r: 0, c: 18 } },
  { s: { r: 1, c: 17 }, e: { r: 1, c: 18 } },
  { s: { r: 0, c: 19 }, e: { r: 0, c: 22 } },
  { s: { r: 0, c: 23 }, e: { r: 0, c: 26 } },
  ...[11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26].map((c) => ({ s: { r: 1, c }, e: { r: 2, c } })),
];

export interface SheetRow {
  baseName: string;
  variety: string | null;
  nameKn: string | null;
  canopy: Canopy | null;
  sizeClass: SizeClass | null;
  categories: string[];
  nitrogenFixer: boolean;
  droughtTolerance: Level | null;
  propagation: Propagation | null;
  tempOpt: number | null;
  tempMin: number | null;
  tempMax: number | null;
  humidityOpt: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  rainfallMin: number | null;
  rainfallMax: number | null;
  spacingFt: Record<string, [number, number] | number | null>;
  compostKg: { at_planting: number | null; y0_2: number | null; y3_6: number | null; y7_plus: number | null };
}

type Cell = string | number | boolean | null | undefined;

const CANOPY: Record<string, { canopy: Canopy; size: SizeClass }> = {
  'large tree': { canopy: 'large_tree', size: 'L' },
  'medium tree': { canopy: 'medium_tree', size: 'M' },
  'small tree': { canopy: 'small_tree', size: 'S' },
  shrub: { canopy: 'shrub', size: 'S' },
  climber: { canopy: 'climber', size: 'S' },
};
const CANOPY_LABEL: Record<Canopy, string> = { large_tree: 'Large tree', medium_tree: 'Medium tree', small_tree: 'Small tree', shrub: 'Shrub', climber: 'Climber' };
const PROPAGATION: Record<string, Propagation> = {
  seeded: 'seeded',
  seed: 'seeded',
  seedling: 'seeded',
  grafted: 'grafted',
  'air layered': 'air_layered',
  'air layering': 'air_layered',
  cuttings: 'cuttings',
  cutting: 'cuttings',
  suckers: 'suckers',
  sucker: 'suckers',
  'tissue culture': 'tissue_culture',
};
const PROPAGATION_LABEL: Record<Propagation, string> = { seeded: 'Seeded', grafted: 'Grafted', air_layered: 'Air layered', cuttings: 'Cuttings', suckers: 'Suckers', tissue_culture: 'Tissue culture', other: 'Other' };
const LEVEL: Record<string, Level> = { high: 'high', yes: 'high', moderate: 'moderate', medium: 'moderate', low: 'low', no: 'low' };
const LEVEL_LABEL: Record<Level, string> = { high: 'High', moderate: 'Moderate', low: 'Low' };
const AREA = ['food_forest', 'miyawaki', 'commercial'] as const;

const text = (c: Cell): string | null => {
  if (c === null || c === undefined) return null;
  const t = String(c).replace(/\s+/g, ' ').trim();
  return t === '' || t === '-' ? null : t;
};
const number = (c: Cell): number | null => {
  const t = text(c);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const key = (c: Cell) => text(c)?.toLowerCase() ?? '';

/** "18 x 18" -> [18, 18]; "-" or blank -> null. */
export function parseSpacing(c: Cell): [number, number] | null {
  const m = text(c)?.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** One data row (0-based columns as in SHEET_HEADER). Returns null for rows without a plant name. */
export function parseSheetRow(row: readonly Cell[]): SheetRow | null {
  const baseName = text(row[1]);
  if (!baseName) return null;
  const canopy = CANOPY[key(row[4])] ?? null;
  return {
    baseName,
    variety: text(row[2]),
    nameKn: text(row[3]),
    canopy: canopy?.canopy ?? null,
    sizeClass: canopy?.size ?? null,
    categories: [row[5], row[6], row[7]].map(text).filter((v): v is string => v !== null),
    nitrogenFixer: key(row[8]) === 'yes',
    droughtTolerance: LEVEL[key(row[9])] ?? null,
    propagation: key(row[10]) ? (PROPAGATION[key(row[10])] ?? 'other') : null,
    tempOpt: number(row[11]),
    tempMin: number(row[12]),
    tempMax: number(row[13]),
    humidityOpt: number(row[14]),
    humidityMin: number(row[15]),
    humidityMax: number(row[16]),
    rainfallMin: number(row[17]),
    rainfallMax: number(row[18]),
    spacingFt: { food_forest: parseSpacing(row[19]), miyawaki: parseSpacing(row[20]), commercial: parseSpacing(row[21]), boundary: number(row[22]) },
    compostKg: { at_planting: number(row[23]), y0_2: number(row[24]), y3_6: number(row[25]), y7_plus: number(row[26]) },
  };
}

/** Inverse of parseSheetRow for export (Sl No is the 1-based row number). */
export function toSheetRow(r: SheetRow, index: number): (string | number | null)[] {
  const sp = (v: [number, number] | number | null | undefined) => (Array.isArray(v) ? `${v[0]} x ${v[1]}` : '-');
  const dash = (v: number | null | undefined) => (v == null ? '-' : v);
  const b = r.spacingFt.boundary;
  return [
    index + 1,
    r.baseName,
    r.variety,
    r.nameKn,
    r.canopy ? CANOPY_LABEL[r.canopy] : null,
    r.categories[0] ?? null,
    r.categories[1] ?? null,
    r.categories[2] ?? null,
    r.nitrogenFixer ? 'Yes' : 'No',
    r.droughtTolerance ? LEVEL_LABEL[r.droughtTolerance] : null,
    r.propagation ? PROPAGATION_LABEL[r.propagation] : null,
    r.tempOpt,
    r.tempMin,
    r.tempMax,
    r.humidityOpt,
    r.humidityMin,
    r.humidityMax,
    r.rainfallMin,
    r.rainfallMax,
    ...AREA.map((m) => sp(r.spacingFt[m])),
    typeof b === 'number' ? b : '-',
    dash(r.compostKg.at_planting),
    dash(r.compostKg.y0_2),
    dash(r.compostKg.y3_6),
    dash(r.compostKg.y7_plus),
  ];
}

/** Match key for a sheet row against products: lowercase "variety base" with punctuation folded. */
export const matchKey = (base: string | null, variety: string | null): string =>
  `${variety ?? ''} ${base ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
