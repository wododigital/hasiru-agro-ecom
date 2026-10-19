// WP-13 seed step 8: one real lead photo per plant that has no image in the backup (BUILD-PLAN 9.8).
//   tsx tooling/scripts/seed/source-missing-images.ts [--dry-run] [--plants key,key] [--retry-missing]
// Programmatic source: Wikimedia Commons (CC BY, CC BY-SA, CC0 or public domain only). Photos taken from Magnific
// stock by hand (the MCP tools, not this script) are appended to the same log with engine "magnific".
// No generated images. Every search and result goes to data/media/sourcing-log.json; files to data/media/masters/sourced/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IMAGE_MAP = process.env.HASIRU_IMAGE_MAP ?? '/Users/shyam/Desktop/Claude Dev Projects/hasiru-agro-ecom/_work/image-map.json';
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ecomkit-seed/1.0 (plant photo sourcing for a nursery store; hello@wodo.digital)';

export interface MissingPlant {
  key: string;
  name: string;
  common: string;
  scientific: string;
}

export interface Candidate {
  title: string;
  url: string;
  descriptionUrl: string;
  width: number;
  height: number;
  mime: string;
  licence: string;
  author: string;
  attributionRequired: boolean;
  description: string;
  categories: string[];
  score: number;
}

export interface SearchLogEntry {
  engine: 'wikimedia' | 'magnific';
  query: string;
  results: number;
  accepted: number;
  note?: string;
}

export interface PlantResult {
  status: 'sourced' | 'missing' | 'shared';
  engine?: 'wikimedia' | 'magnific';
  file?: string;
  sha256?: string;
  licence?: string;
  author?: string | null;
  source_url?: string;
  credit_required?: boolean;
  credit?: string;
  width?: number;
  height?: number;
  same_as?: string;
  /** Visible subject of the photo, for the reviewer. */
  subject?: string;
  searches: SearchLogEntry[];
  notes?: string[];
}

export interface SourcingLog {
  version: 1;
  generated_at: string;
  policy: string;
  plants: Record<string, PlantResult>;
}

/** Plants that reuse another row's photo (research image-inventory section 4). */
export const SHARED_WITH: Record<string, string> = {
  'carissa-carandas-l-hedge': 'karonda',
  'sapindus-emarginatus-vahl': 'soapnut-antwala',
  'banana-robusta-pachbaale': 'banana-yelakki',
  'banana-red': 'banana-yelakki',
};

/**
 * Files looked at on a contact sheet and turned down (wrong subject, bark close-up, herbarium scan, animal in
 * frame...). Matched on the Commons file title; the plant is searched again without them.
 */
export const REJECTED_FILES: Record<string, string> = {
  'Bananapao.JPG': 'red banana fruit on a mat, not a plant photo and the wrong cultivar for the banana rows',
  'Barking deer female chewing a Careya arborea fruit AJTJohnsingh.jpg': 'an animal is the subject',
  'Chlororoxylon swietenia tree Billudu Kambalakonda Visakhapatnam.JPG': 'bark close-up',
  'A species of Rutaceae; branch with flowers and fruit and sep Wellcome V0042618.jpg': 'historic illustration, not a photograph of the plant',
  'Ehretia aspera leaf.webp': 'herbarium scan',
  '09424jfPaddy fields trees irrigation canals Farm to Market Road Talampas Bustos Bulacanfvf 13.jpg': 'landscape, plant not identifiable',
  'Bedda Nut tree (3394206467).jpg': 'bark close-up',
  'Feronia Elephantum tree.JPG': 'trunk close-up',
  '(Wrightia tinctoria) Ankudu tree at Kambalakonda 02.JPG': 'trunk close-up',
  'HK CWB 高士威道 Causeway Bay Road 維多利亞公園 Victoria Park tree Sept 2017 IX1 蒲桃 Syzygium jambos 03.jpg': 'street tree with a bird, plant barely visible',
  'Starr-090601-8720-Tithonia diversifolia-habit with grazing horse-Upper road Kanaio-Maui (24334975983).jpg': 'a grazing animal dominates the frame',
  'Indian Ash tree (3297717278).jpg': 'leafless branches only',
  'Artocarpus lakoocha feuilles et fruits Laos.jpg': 'frame shows palm fronds, subject not confirmed',
  'Avoidance of Chloroxylon swietenia by sambar, AJT Johnsingh. P1010340.jpg': 'two deer fill the frame',
  'Ehretia cymosa flowers.jpg': 'a different Ehretia species',
  'Ivory tree (3272433568).jpg': 'trunk close-up',
  'Ehretia cymosa-flowers.jpg': 'a different Ehretia species',
  'Marigold garden (Tagetes patula).jpg': 'French marigold (Tagetes patula), the plant list wants Tagetes erecta',
};

/** Extra Commons queries tried when the botanical-name search gives nothing good (score below GOOD_ENOUGH). */
export const EXTRA_QUERIES: Record<string, string[]> = {
  'banana-yelakki': ['"Musa" banana plant bunch', '"Banana plant" tree'],
  'wood-apple': ['"Limonia acidissima" fruit', '"Wood apple" tree'],
  'wrightia-tinctoria-roxb-r-br': ['"Wrightia tinctoria" flowers', '"Wrightia tinctoria" tree'],
  'rose-apple-panneralu': ['"Syzygium jambos" fruit', '"Rose apple" tree'],
  'mexican-sunflower': ['"Tithonia diversifolia" flowers', '"Mexican sunflower" plant'],
  'lannea-coromandelica-houtt-merr': ['"Lannea coromandelica" tree leaves', '"Odina wodier"'],
  'marigold': ['"Tagetes erecta" flower', '"African marigold" plant'],
  'monkey-jack': ['"Artocarpus lacucha" fruit', '"Artocarpus lakoocha" tree'],
  'curry-leaves': ['"Murraya koenigii" leaves', '"Curry tree" plant'],
  'careya-arborea-roxb': ['"Careya arborea" tree', '"Careya arborea" flowers'],
  'ehretia-aspera-willd': ['"Ehretia" aspera flowers', '"Ehretia laevis"'],
  'pithecellobium-dulce-roxb-benth': ['"Pithecellobium dulce" tree', '"Pithecellobium dulce" pods'],
  'terminalia-bellirica-gaertn-roxb': ['"Terminalia bellirica" fruit', '"Terminalia bellirica" leaves'],
  'chloroxylon-swietenia-dc': ['"Chloroxylon swietenia" leaves', '"Chloroxylon swietenia" flowers'],
};

/** A candidate at or above this needs no extra query. */
export const GOOD_ENOUGH = 16;

/** "Madhuca longifolia var. latifolia (Roxb.) A.Chev." -> "Madhuca longifolia". Empty when there is no binomial. */
export function binomial(scientific: string): string {
  const m = /^([A-Z][a-z-]+)\s+([a-z-]{3,})\b/.exec(scientific.trim());
  return m ? `${m[1]} ${m[2]}` : '';
}

const ALLOWED_LICENCE = /^(CC[ -]BY([ -]SA)?[ -]\d(\.\d)?(\s.*)?|CC0.*|Public domain.*|PD.*)$/i;
export function licenceAllowed(short: string): boolean {
  const s = short.trim();
  if (!s || /\b(NC|ND)\b/i.test(s)) return false;
  return ALLOWED_LICENCE.test(s);
}

const GOOD = /\b(tree|trees|fruit|fruits|plant|plants|habit|foliage|leaves|flowers?|pods?|shrub|grove|crop|field|garden)\b/i;
const BAD = /\b(deer|goat|horse|cow|cattle|bird|insect|butterfly|bee|wellcome|trunk|stem|landscape|street|road|wellcome|herbarium|specimen|illustration|drawing|plate|painting|map|distribution|seeds?|bark|log|logs|timber|svg|stamp|cross[- ]section|pressed|sheet|holotype|isotype|type|pdf|page|diagram|logo|icon|herbal|powder|oil|extract|capsule|tablet|packet|bottle|cooked|dish|recipe|chart)\b/i;

/** Higher is better; negative means do not use. Pure and tested. */
export function scoreCandidate(c: Omit<Candidate, 'score'>, bin: string, common: string): number {
  if (REJECTED_FILES[c.title]) return -1;
  if (!/^image\/(jpeg|png|webp)$/.test(c.mime)) return -1;
  if (!licenceAllowed(c.licence)) return -1;
  if (Math.min(c.width, c.height) < 700) return -1;
  const hay = `${c.title} ${c.categories.join(' ')} ${c.description}`.toLowerCase();
  const genus = bin.split(' ')[0]?.toLowerCase() ?? '';
  // A common name that is only the genus ("Ehretia") would accept any species of it, so it does not count.
  const names = [bin.toLowerCase(), ...(common ? [common.toLowerCase().replace(/\s*\(.*\)/, '')] : [])].filter((n) => n.length > 3 && n !== genus);
  const subjectOk = names.some((n) => c.title.toLowerCase().includes(n) || c.categories.some((cat) => cat.toLowerCase().includes(n)));
  if (!subjectOk) return -1;
  if (BAD.test(c.title)) return -1;
  let s = 10;
  if (GOOD.test(c.title)) s += 6;
  if (hay.includes(bin.toLowerCase())) s += 3;
  if (c.width >= 1200) s += 3;
  if (c.width / c.height >= 1 && c.width / c.height <= 1.8) s += 2;
  if (/\b(sapling|seedling|nursery)\b/i.test(c.title)) s += 2;
  if (/\b(flower|flowers)\b/i.test(c.title) && !/\b(tree|plant|fruit)\b/i.test(c.title)) s -= 2;
  if (/\b(leaf|leaves)\b/i.test(c.title) && !/\b(tree|plant|fruit)\b/i.test(c.title)) s -= 2;
  if (/\bunidentified|cf\.|\?/i.test(c.title)) s -= 5;
  return s;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- MediaWiki response shape

/** Parses a Commons `query` response into candidates (scored later). */
export function parseCommons(body: Json): Omit<Candidate, 'score'>[] {
  const pages: Json[] = Object.values(body?.query?.pages ?? {});
  const out: Omit<Candidate, 'score'>[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    out.push({
      title: String(p.title ?? '').replace(/^File:/, ''),
      url: String(info.thumburl ?? info.url),
      descriptionUrl: String(info.descriptionurl ?? ''),
      width: Number(info.thumbwidth ?? info.width),
      height: Number(info.thumbheight ?? info.height),
      mime: String(info.mime ?? ''),
      licence: String(meta.LicenseShortName?.value ?? ''),
      author: stripHtml(String(meta.Artist?.value ?? '')) || 'Unknown author',
      attributionRequired: String(meta.AttributionRequired?.value ?? 'true') !== 'false',
      description: stripHtml(String(meta.ImageDescription?.value ?? '')),
      categories: ((p.categories ?? []) as { title: string }[]).map((c) => c.title.replace(/^Category:/, '')),
    });
  }
  return out;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function searchCommons(fetcher: Fetcher, query: string): Promise<Omit<Candidate, 'score'>[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '40',
    prop: 'imageinfo|categories',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
    cllimit: 'max',
    origin: '*',
  });
  const res = await fetcher(`${API}?${params}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Commons search failed with ${res.status}`);
  return parseCommons((await res.json()) as Json);
}

export interface SourceOptions {
  mediaDir: string;
  plants: MissingPlant[];
  dryRun: boolean;
  fetcher?: Fetcher;
  /** Only these plant keys (default: all). */
  only?: string[];
  retryMissing?: boolean;
  now?: () => Date;
  delayMs?: number;
  log?: (message: string) => void;
}

export function loadLog(mediaDir: string): SourcingLog {
  const file = join(mediaDir, 'sourcing-log.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as SourcingLog;
  return { version: 1, generated_at: '', policy: '', plants: {} };
}

const POLICY = 'Real photographs only. Wikimedia Commons files under CC BY, CC BY-SA, CC0 or public domain; Magnific stock photographs (not generated). Author, licence and source recorded per file. No AI-generated images.';

export async function sourceMissingImages(opts: SourceOptions): Promise<SourcingLog> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const say = opts.log ?? (() => undefined);
  const log = loadLog(opts.mediaDir);
  const outDir = join(opts.mediaDir, 'masters', 'sourced');
  const targets = opts.plants.filter((p) => !opts.only?.length || opts.only.includes(p.key));
  // A photo that was reviewed and turned down is removed and re-sourced without it.
  for (const [key, entry] of Object.entries(log.plants)) {
    if (entry.status === 'sourced' && entry.engine === 'wikimedia' && entry.subject && REJECTED_FILES[entry.subject] && !opts.dryRun) {
      if (entry.file) rmSync(join(opts.mediaDir, 'masters', entry.file), { force: true });
      delete log.plants[key];
    }
  }
  const byBinomial = new Map<string, string>(); // binomial -> first plant key that used it

  for (const plant of targets) {
    const existing = log.plants[plant.key];
    const bin = binomial(plant.scientific);
    const leader = SHARED_WITH[plant.key] ?? (bin ? byBinomial.get(bin) : undefined);
    if (bin && !byBinomial.has(bin) && !SHARED_WITH[plant.key]) byBinomial.set(bin, plant.key);
    if (existing && (existing.status !== 'missing' || !opts.retryMissing)) continue;
    if (leader && leader !== plant.key) {
      log.plants[plant.key] = { status: 'shared', same_as: leader, searches: [] };
      continue;
    }
    if (opts.dryRun) {
      say(`dry run: would search Commons for ${plant.key} (${bin || plant.common})`);
      continue;
    }

    const searches: SearchLogEntry[] = [];
    const queries = [bin ? `"${bin}"` : `"${plant.common.replace(/\s*\(.*\)/, '')}"`, ...(EXTRA_QUERIES[plant.key] ?? [])];
    let best: Candidate | null = null;
    for (const [i, query] of queries.entries()) {
      if (i > 0 && best && best.score >= GOOD_ENOUGH) break;
      const found = await searchCommons(fetcher, query);
      const scored = found.map((c) => ({ ...c, score: scoreCandidate(c, bin || plant.common, plant.common) })).filter((c) => c.score >= 0);
      searches.push({ engine: 'wikimedia', query, results: found.length, accepted: scored.length });
      scored.sort((a, b) => b.score - a.score || b.width - a.width || a.title.localeCompare(b.title));
      if (scored[0] && (!best || scored[0].score > best.score)) best = scored[0];
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    if (!best) {
      log.plants[plant.key] = { status: 'missing', searches, notes: ['No Commons file with an allowed licence and a clear subject; keeps image_needed and the collection placeholder.'] };
      say(`missing: ${plant.key}`);
      continue;
    }
    const res = await fetcher(best.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`download failed for ${plant.key}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const ext = best.mime === 'image/png' ? 'png' : best.mime === 'image/webp' ? 'webp' : 'jpg';
    const rel = `sourced/${plant.key}.${ext}`;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(opts.mediaDir, 'masters', rel), bytes);
    log.plants[plant.key] = {
      status: 'sourced',
      engine: 'wikimedia',
      file: rel,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      licence: best.licence,
      author: best.author,
      source_url: best.descriptionUrl,
      credit_required: best.attributionRequired,
      credit: `Photo: ${best.author}, ${best.licence}, via Wikimedia Commons`,
      width: best.width,
      height: best.height,
      subject: best.title,
      searches,
    };
    say(`sourced: ${plant.key} <- ${best.title}`);
    writeFileSync(join(opts.mediaDir, 'sourcing-log.json'), `${JSON.stringify(sortLog(log, opts.now), null, 2)}\n`);
  }

  const sorted = sortLog(log, opts.now);
  if (!opts.dryRun) writeFileSync(join(opts.mediaDir, 'sourcing-log.json'), `${JSON.stringify(sorted, null, 2)}\n`);
  return sorted;
}

function sortLog(log: SourcingLog, now = () => new Date()): SourcingLog {
  return { version: 1, generated_at: now().toISOString(), policy: POLICY, plants: Object.fromEntries(Object.entries(log.plants).sort(([a], [b]) => a.localeCompare(b))) };
}

export function readMissingPlants(file = IMAGE_MAP): MissingPlant[] {
  const map = JSON.parse(readFileSync(file, 'utf8')) as { plants: Record<string, { name: string; search: { common: string; scientific: string } }>; missing: string[] };
  return map.missing.map((key) => ({ key, name: map.plants[key]!.name, common: map.plants[key]!.search.common, scientific: map.plants[key]!.search.scientific }));
}

const arg = (name: string) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await sourceMissingImages({
    mediaDir: join(ROOT, 'data', 'media'),
    plants: readMissingPlants(),
    dryRun: process.argv.includes('--dry-run'),
    only: arg('plants')?.split(','),
    retryMissing: process.argv.includes('--retry-missing'),
    delayMs: 1000,
    log: (m) => console.log(m),
  });
  const counts = Object.values(result.plants).reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {});
  console.log('sourcing summary', counts);
}
