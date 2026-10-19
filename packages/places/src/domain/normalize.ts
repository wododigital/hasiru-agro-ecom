// Turns the client's district sheet rows into canonical names, aliases, slugs and tags. Pure functions.
import { slugify } from '@ecomkit/core/ids';

/** Spellings the sheet has that differ from the current official name (BUILD-PLAN 9.6), keyed `STATE:Sheet name`. */
const CANONICAL: Record<string, { name: string; aliases?: string[] }> = {
  'KA:Mysore': { name: 'Mysuru', aliases: ['Mysore'] },
  'KA:Raicur': { name: 'Raichur', aliases: ['Raicur'] },
  'KA:Kodugu': { name: 'Kodagu', aliases: ['Kodugu', 'Coorg'] },
  'KA:Karwar': { name: 'Uttara Kannada', aliases: ['Karwar', 'North Canara'] },
  'KA:Bijapur': { name: 'Vijayapura', aliases: ['Bijapur'] },
  'KA:Tumkur': { name: 'Tumakuru', aliases: ['Tumkur'] },
  'KA:Chikmagaluru': { name: 'Chikkamagaluru', aliases: ['Chikmagaluru', 'Chikmagalur'] },
  'KA:Chikballapur': { name: 'Chikkaballapura', aliases: ['Chikballapur', 'Chikkaballapur'] },
  'KA:Davangere': { name: 'Davanagere', aliases: ['Davangere'] },
  'KA:Shivamogga': { name: 'Shivamogga', aliases: ['Shimoga'] },
  'KA:Dakshina Kannada': { name: 'Dakshina Kannada', aliases: ['Mangaluru', 'Mangalore', 'South Canara'] },
  'KA:Bengaluru Urban': { name: 'Bengaluru Urban', aliases: ['Bangalore Urban', 'Bangalore', 'Bengaluru'] },
  'KA:Bengaluru Rural': { name: 'Bengaluru Rural', aliases: ['Bangalore Rural'] },
  'KA:Ramanagara': { name: 'Ramanagara', aliases: ['Ramnagar', 'Bidadi'] },
  'KA:Chamarajanagar': { name: 'Chamarajanagar', aliases: ['Chamrajnagar'] },
  'KA:Dharwad': { name: 'Dharwad', aliases: ['Hubballi', 'Hubli', 'Hubballi-Dharwad'] },
  'TN:Krishnageri': { name: 'Krishnagiri', aliases: ['Krishnageri'] },
  'TN:Kancheepuram': { name: 'Kancheepuram', aliases: ['Kanchipuram'] },
  'TN:Chengalpet': { name: 'Chengalpattu', aliases: ['Chengalpet'] },
  'TN:Tuticorin': { name: 'Thoothukudi', aliases: ['Tuticorin'] },
  'TN:Trichirappalli': { name: 'Tiruchirappalli', aliases: ['Trichy', 'Trichirappalli', 'Tiruchirapalli'] },
  'TN:Thirunelveli': { name: 'Tirunelveli', aliases: ['Thirunelveli'] },
  'TN:Thirupathur': { name: 'Tirupathur', aliases: ['Thirupathur'] },
  'TN:Viluppuram': { name: 'Villupuram', aliases: ['Viluppuram'] },
  'TN:Pudukottai': { name: 'Pudukkottai', aliases: ['Pudukottai'] },
  'TN:The Nilgiris': { name: 'The Nilgiris', aliases: ['Nilgiris', 'Ooty', 'Udhagamandalam'] },
  'AP:Sri Potti Sriramulu Nellore': { name: 'Nellore', aliases: ['Sri Potti Sriramulu Nellore', 'SPSR Nellore'] },
  'AP:YSR District, Kadapa': { name: 'Kadapa', aliases: ['YSR Kadapa', 'YSR District', 'Cuddapah'] },
  'MH:Aurangabad': { name: 'Chhatrapati Sambhajinagar', aliases: ['Aurangabad'] },
  'MH:Osmanabad': { name: 'Dharashiv', aliases: ['Osmanabad'] },
  'MH:Ahmednagar': { name: 'Ahilyanagar', aliases: ['Ahmednagar'] },
  'UP:Allahabad': { name: 'Prayagraj', aliases: ['Allahabad'] },
  'UP:Faizabad': { name: 'Ayodhya', aliases: ['Faizabad'] },
  'UP:Lakhimpur - Kheri': { name: 'Lakhimpur Kheri', aliases: ['Kheri'] },
  'WB:Paschim Medinipur (West Medinipur)': { name: 'Paschim Medinipur', aliases: ['West Medinipur', 'West Midnapore'] },
  'WB:Purba Medinipur (East Medinipur)': { name: 'Purba Medinipur', aliases: ['East Medinipur', 'East Midnapore'] },
  'WB:Paschim (West) Burdwan (Bardhaman)': { name: 'Paschim Bardhaman', aliases: ['West Burdwan', 'Paschim Burdwan', 'Asansol'] },
  'WB:Purba Burdwan (Bardhaman)': { name: 'Purba Bardhaman', aliases: ['East Burdwan', 'Purba Burdwan', 'Bardhaman'] },
  'WB:Dakshin Dinajpur (South Dinajpur)': { name: 'Dakshin Dinajpur', aliases: ['South Dinajpur'] },
  'WB:Uttar Dinajpur (North Dinajpur)': { name: 'Uttar Dinajpur', aliases: ['North Dinajpur'] },
  'TG:Warangal (Rural)': { name: 'Warangal Rural', aliases: ['Warangal (Rural)'] },
  'TG:Warangal (Urban)': { name: 'Warangal Urban', aliases: ['Warangal (Urban)', 'Hanamkonda'] },
  'TG:Rangareddy': { name: 'Rangareddy', aliases: ['Ranga Reddy'] },
  'PB:Sahibzada Ajit Singh Nagar (Mohali)': { name: 'Sahibzada Ajit Singh Nagar', aliases: ['Mohali', 'SAS Nagar'] },
  'PB:Nawanshahr (Shahid Bhagat Singh Nagar)': { name: 'Shahid Bhagat Singh Nagar', aliases: ['Nawanshahr'] },
  'UP:Amethi (Chatrapati Sahuji Mahraj Nagar)': { name: 'Amethi', aliases: ['Chatrapati Sahuji Mahraj Nagar'] },
  'UP:Hapur (Panchsheel Nagar)': { name: 'Hapur', aliases: ['Panchsheel Nagar'] },
  'HR:Gurugram (Gurgaon)': { name: 'Gurugram', aliases: ['Gurgaon'] },
  'AS:Karimganj': { name: 'Sribhumi', aliases: ['Karimganj'] },
  'OD:Kendujhar (Keonjhar)': { name: 'Kendujhar', aliases: ['Keonjhar'] },
  'OD:Sonepur': { name: 'Subarnapur', aliases: ['Sonepur', 'Sonepur'] },
};

export const stripSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Seed text rule (SCHEMA.md): no em or en dashes. A spaced dash becomes a comma, a joining dash a hyphen. */
export function noDashes(text: string): string {
  return stripSpaces(text.replace(/\s+[\u2013\u2014]\s+/g, ', ').replace(/[\u2013\u2014]/g, '-'));
}

/** All spellings people type for the same place, deduplicated case-insensitively, canonical name excluded. */
function uniqueAliases(name: string, candidates: string[]): string[] {
  const seen = new Set([name.toLowerCase()]);
  const out: string[] = [];
  for (const c of candidates.map(stripSpaces).filter(Boolean)) {
    const k = c.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

export interface CanonicalDistrict {
  name: string;
  aliases: string[];
  /** True when the canonical name differs from the sheet spelling. */
  renamed: boolean;
}

/** "Ballari (Bellary)" -> Ballari + alias Bellary; known variants map to the current official name. */
export function canonicalDistrict(sheetName: string, stateCode: string): CanonicalDistrict {
  const raw = stripSpaces(sheetName);
  const known = CANONICAL[`${stateCode}:${raw}`];
  if (known) {
    return { name: known.name, aliases: uniqueAliases(known.name, [raw, ...(known.aliases ?? [])]), renamed: known.name !== raw };
  }
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(raw);
  if (m) {
    const name = stripSpaces(m[1]!);
    return { name, aliases: uniqueAliases(name, [raw, ...m[2]!.split(/[,/]/)]), renamed: name !== raw };
  }
  return { name: raw, aliases: [], renamed: false };
}

/**
 * Slugs are the plain name; names that exist in more than one state (Aurangabad, Bilaspur, Pratapgarh...)
 * get the lowercase state code appended on every colliding row so URLs never depend on row order.
 */
export function assignSlugs(rows: readonly { name: string; stateCode: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(slugify(r.name), (counts.get(slugify(r.name)) ?? 0) + 1);
  return rows.map((r) => {
    const base = slugify(r.name);
    return counts.get(base)! > 1 ? `${base}-${r.stateCode.toLowerCase()}` : base;
  });
}

const SOIL_KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ['red', /\bred\b/],
  ['black', /\bblack\b|\bregur\b|\bcotton soil\b/],
  ['laterite', /\blaterit/],
  ['alluvial', /\balluvi|\bdelta/],
  ['sandy', /\bsand/],
  ['loamy', /\bloam/],
  ['clay', /\bclay/],
  ['coastal', /\bcoastal\b|\bsaline\b|\bcoast\b/],
  ['hill', /\bhill|\bmountain|\bforest soil\b|\bhilly\b/],
];

export function soilTags(soilText: string | null | undefined): string[] {
  const t = (soilText ?? '').toLowerCase();
  return SOIL_KEYWORDS.filter(([, re]) => re.test(t)).map(([tag]) => tag);
}

/** Splits "Coffee, black pepper, potato, and paddy" into trimmed lowercase items. */
export function parseList(text: string | null | undefined, options: { lower?: boolean } = {}): string[] {
  if (!text) return [];
  const items = String(text)
    .split(/,|;|\band\b|&|\//i)
    .map((s) => stripSpaces(s).replace(/^and\s+/i, '').replace(/\.$/, ''))
    .filter((s) => s && s.toLowerCase() !== 'na');
  const out = options.lower === false ? items : items.map((s) => s.toLowerCase());
  return [...new Set(out)];
}
