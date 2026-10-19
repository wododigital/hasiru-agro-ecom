// WP-13 seed step 7: India Post pincode directory -> data/seed/pincodes.csv (pincode,office_name,district_slug,state_code).
// Source: the open "All India Pincode Directory" (data.gov.in, Open Government Data licence) as mirrored under CC0.
// The raw file is kept in data/raw/pincodes/ (not committed). When it is missing and cannot be downloaded the step
// writes nothing, and the places seed hook sets settings.places.pincode_lookup = false.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// @boundaries-ignore type-only: core is loaded at runtime through the app's dependency graph
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
// @boundaries-ignore the seed pipeline reuses the package's pure domain code instead of a second copy
import {
  buildDistrictMatcher,
  cleanOfficeName,
  csvEscape,
  districtsFileSchema,
  OFFICE_RANK,
  parseCsvLine,
  PINCODE_RE,
  stateFromSheet,
} from '../../../packages/places/src/domain';

export const PINCODE_SOURCE_URL = 'https://raw.githubusercontent.com/harsha1205/Pincode-India-CSV/main/India%20Pincode%20Database.csv';
export const PINCODE_HEADER = 'pincode,office_name,district_slug,state_code';

interface Office {
  pincode: string;
  name: string;
  type: string;
  delivery: boolean;
  district: string;
  state: string;
}

export interface PincodeBuild {
  csv: string;
  rows: number;
  matched: number;
  unmatchedByState: Record<string, number>;
}

/** Pure step (tested): directory CSV text + districts -> the seed CSV. */
export function buildPincodes(
  directoryCsv: string,
  districts: readonly { slug: string; name: string; state_code: string; aliases: readonly string[] }[],
): PincodeBuild {
  const matcher = buildDistrictMatcher(districts.map((d) => ({ slug: d.slug, name: d.name, stateCode: d.state_code, aliases: d.aliases })));
  const lines = directoryCsv.split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const col = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`pincode directory has no "${n}" column`);
    return i;
  };
  const [iPin, iOffice, iType, iDel, iDist, iState, iCircle] = ['pincode', 'officename', 'officetype', 'delivery', 'district', 'statename', 'circlename'].map(col) as [number, number, number, number, number, number, number];

  const byPin = new Map<string, Office[]>();
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const pincode = (f[iPin] ?? '').trim();
    if (!PINCODE_RE.test(pincode)) continue;
    let state = (f[iState] ?? '').trim();
    if (!state || state.toUpperCase() === 'NA') state = (f[iCircle] ?? '').replace(/\s+circle$/i, '').trim();
    const list = byPin.get(pincode) ?? [];
    list.push({ pincode, name: f[iOffice] ?? '', type: (f[iType] ?? '').trim(), delivery: /^delivery$/i.test((f[iDel] ?? '').trim()), district: (f[iDist] ?? '').trim(), state });
    byPin.set(pincode, list);
  }

  const out: string[] = [];
  let matched = 0;
  const unmatchedByState: Record<string, number> = {};
  for (const pincode of [...byPin.keys()].sort()) {
    const offices = byPin.get(pincode)!;
    const stateCounts = new Map<string, number>();
    for (const o of offices) {
      const st = stateFromSheet(o.state);
      if (st) stateCounts.set(st.code, (stateCounts.get(st.code) ?? 0) + 1);
    }
    const stateCode = [...stateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (!stateCode) continue; // state unknown even from the circle: not usable
    const rep = [...offices].sort(
      (a, b) => Number(b.delivery) - Number(a.delivery) || (OFFICE_RANK[a.type] ?? 3) - (OFFICE_RANK[b.type] ?? 3) || a.name.localeCompare(b.name),
    )[0]!;
    // Majority vote over the pincode's offices that fall in the winning state.
    const votes = new Map<string, number>();
    for (const o of offices) {
      if (stateFromSheet(o.state)?.code !== stateCode || !o.district || o.district.toUpperCase() === 'NA') continue;
      const m = matcher.match(o.district, stateCode);
      if (m) votes.set(m.slug, (votes.get(m.slug) ?? 0) + 1);
    }
    const slug = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    if (slug) matched++;
    else unmatchedByState[stateCode] = (unmatchedByState[stateCode] ?? 0) + 1;
    out.push([pincode, csvEscape(cleanOfficeName(rep.name)), slug, stateCode].join(','));
  }
  return { csv: `${PINCODE_HEADER}\n${out.join('\n')}\n`, rows: out.length, matched, unmatchedByState };
}

async function findRawFile(rawDir: string, ctx: SeedContext): Promise<string | null> {
  const existing = existsSync(rawDir) ? readdirSync(rawDir).find((f) => f.endsWith('.csv')) : undefined;
  if (existing) return join(rawDir, existing);
  if (ctx.dryRun || process.env.ECOMKIT_OFFLINE === '1') return null;
  try {
    const res = await fetch(PINCODE_SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(rawDir, { recursive: true });
    const file = join(rawDir, 'india-pincode-database.csv');
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch (err) {
    ctx.log.warn(`pincodes: download failed (${String(err)})`);
    return null;
  }
}

export default async function pincodes(ctx: SeedContext): Promise<void> {
  const target = join(ctx.seedDir, 'pincodes.csv');
  const rawDir = join(ctx.seedDir, '..', 'raw', 'pincodes');
  const districtsFile = join(ctx.seedDir, 'districts.json');
  if (!existsSync(districtsFile)) {
    ctx.log.warn('pincodes: data/seed/districts.json missing, run the districts step first');
    return;
  }
  const raw = await findRawFile(rawDir, ctx);
  if (!raw) {
    ctx.log.warn('pincodes: directory not available, places_pincode stays empty and settings.places.pincode_lookup will be false');
    return;
  }
  const { records } = districtsFileSchema.parse(JSON.parse(readFileSync(districtsFile, 'utf8')));
  const built = buildPincodes(readFileSync(raw, 'utf8'), records.districts);
  ctx.log.info(`pincodes: ${built.rows} pincodes, ${built.matched} with a district (${Math.round((built.matched / built.rows) * 100)}%)`, { unmatchedByState: built.unmatchedByState });
  if (ctx.dryRun) return;
  if (existsSync(target) && readFileSync(target, 'utf8') === built.csv) return;
  writeFileSync(target, built.csv);
}
