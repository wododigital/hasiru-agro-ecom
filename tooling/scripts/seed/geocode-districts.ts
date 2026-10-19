// One-off helper behind data/seed/district-hq.json: looks up each district's headquarters town once and stores
// the result, so seeding and runtime never call a geocoder (BUILD-PLAN 9.6). Re-run only to refresh the table.
//   tsx tooling/scripts/seed/geocode-districts.ts [--only KA] [--out path]
// Data (c) OpenStreetMap contributors, ODbL. Respects the public Nominatim limit of one request per second.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @boundaries-ignore the seed pipeline reuses the package's pure domain code instead of a second copy
import { canonicalDistrict, stateFromSheet } from '../../../packages/places/src/domain';
import { readSheet } from './districts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1]! : `${ROOT}data/seed/district-hq.json`;
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/** Districts whose headquarters town is not named like the district, keyed `STATE:canonical name`. */
const HQ_TOWN: Record<string, string> = {
  'KA:Dakshina Kannada': 'Mangaluru',
  'KA:Uttara Kannada': 'Karwar',
  'KA:Kodagu': 'Madikeri',
  'KA:Bengaluru Urban': 'Bengaluru',
  'KA:Bengaluru Rural': 'Devanahalli',
  'KA:Vijayanagara': 'Hosapete',
  'KA:Chamarajanagar': 'Chamarajanagar',
  'TN:The Nilgiris': 'Udhagamandalam',
  'TN:Kanyakumari': 'Nagercoil',
  'TN:Kancheepuram': 'Kanchipuram',
  'TN:Ranipet': 'Ranipet',
  'KL:Ernakulam': 'Kakkanad',
  'KL:Wayanad': 'Kalpetta',
  'KL:Idukki': 'Painavu',
  'AP:East Godavari': 'Kakinada',
  'AP:West Godavari': 'Eluru',
  'AP:Krishna': 'Machilipatnam',
  'AP:Prakasam': 'Ongole',
  'TG:Rangareddy': 'Shamshabad',
  'TG:Jayashankar Bhoopalpally': 'Bhupalpally',
  'TG:Komaram Bheem Asifabad': 'Asifabad',
  'TG:Yadadri Bhuvanagiri': 'Bhongir',
  'TG:Warangal Urban': 'Hanamkonda',
  'TG:Warangal Rural': 'Warangal',
  'TG:Rajanna Sircilla': 'Sircilla',
  'TG:Jogulamba Gadwal': 'Gadwal',
  'TG:Bhadradri Kothagudem': 'Kothagudem',
  'MH:Mumbai City': 'Mumbai',
  'MH:Mumbai Suburban': 'Bandra',
  'MH:Raigad': 'Alibag',
  'MH:Sindhudurg': 'Oros',
  'MH:Chhatrapati Sambhajinagar': 'Chhatrapati Sambhajinagar',
  'MH:Ahilyanagar': 'Ahmednagar',
  'UP:Amethi': 'Gauriganj',
  'UP:Bhadohi': 'Gyanpur',
  'UP:Gautam Buddha Nagar': 'Noida',
  'UP:Kanpur Dehat': 'Akbarpur, Kanpur Dehat',
  'UP:Kanpur Nagar': 'Kanpur',
  'UP:Kanshiram Nagar (Kasganj)': 'Kasganj',
  'UP:Sambhal': 'Sambhal',
  'UP:Shamali': 'Shamli',
  'UP:Maharajganj': 'Maharajganj',
  'UP:Sant Kabir Nagar': 'Khalilabad',
  'UP:Siddharth Nagar': 'Naugarh',
  'UP:Ambedkar Nagar': 'Akbarpur, Ambedkar Nagar',
  'UP:Hapur': 'Hapur',
  'UP:Lakhimpur Kheri': 'Lakhimpur',
  'UP:Kushinagar (Padrauna)': 'Padrauna',
  'GJ:Kachchh': 'Bhuj',
  'GJ:Dangs (Ahwa)': 'Ahwa',
  'GJ:Devbhoomi Dwarka': 'Khambhalia',
  'GJ:Gir Somnath': 'Veraval',
  'GJ:Chhota Udepur': 'Chhota Udaipur',
  'GJ:Aravalli': 'Modasa',
  'GJ:Mahisagar': 'Lunavada',
  'GJ:Morbi': 'Morbi',
  'GJ:Botad': 'Botad',
  'GJ:Patan': 'Patan, Gujarat',
  'RJ:Pratapgarh': 'Pratapgarh, Rajasthan',
  'RJ:Sawai Madhopur': 'Sawai Madhopur',
  'WB:Alipurduar': 'Alipurduar',
  'WB:Jhargram': 'Jhargram',
  'WB:Paschim Medinipur': 'Midnapore',
  'WB:Purba Medinipur': 'Tamluk',
  'WB:Paschim Bardhaman': 'Asansol',
  'WB:Purba Bardhaman': 'Bardhaman',
  'WB:Dakshin Dinajpur': 'Balurghat',
  'WB:Uttar Dinajpur': 'Raiganj',
  'WB:North 24 Parganas': 'Barasat',
  'WB:South 24 Parganas': 'Alipore',
  'WB:Cooch Behar': 'Cooch Behar',
  'OD:Kendujhar': 'Keonjhar',
  'OD:Subarnapur': 'Sonepur',
  'OD:Khordha': 'Bhubaneswar',
  'OD:Jagatsinghapur': 'Jagatsinghpur',
  'OD:Boudh': 'Boudh',
  'AS:Kamrup': 'Amingaon',
  'AS:Kamrup Metropolitan': 'Guwahati',
  'AS:Sribhumi': 'Karimganj',
  'AS:Dima Hasao (North Cachar Hills)': 'Haflong',
  'AS:South Salamara-Mankachar': 'Mankachar',
  'AS:Charaideo': 'Sonari',
  'AS:Biswanath': 'Biswanath Chariali',
  'AS:Hojai': 'Hojai',
  'AS:Majuli': 'Majuli',
  'AS:Lakhimpur': 'North Lakhimpur',
  'AR:Papum Pare': 'Yupia',
  'AR:Lower Subansiri': 'Ziro',
  'AR:Upper Subansiri': 'Daporijo',
  'AR:East Siang': 'Pasighat',
  'AR:West Siang': 'Aalo',
  'AR:Siang': 'Boleng',
  'AR:Lower Siang': 'Likabali',
  'AR:Upper Siang': 'Yingkiong',
  'AR:Dibang Valley': 'Anini',
  'AR:Lower Dibang Valley': 'Roing',
  'AR:East Kameng': 'Seppa',
  'AR:West Kameng': 'Bomdila',
  'AR:Kurung Kumey': 'Koloriang',
  'AR:Kra Daadi': 'Jamin',
  'AR:Kamle': 'Raga',
  'AR:Lepa Rada': 'Basar',
  'AR:Shi Yomi': 'Tato',
  'AR:Pakke Kessang': 'Lemmi',
  'AR:Anjaw': 'Hawai',
  'AR:Lohit': 'Tezu',
  'AR:Changlang': 'Changlang',
  'AR:Longding': 'Longding',
  'AR:Tirap': 'Khonsa',
  'AR:Namsai': 'Namsai',
  'AR:Tawang': 'Tawang',
  'MN:Imphal East': 'Porompat',
  'MN:Imphal West': 'Lamphelpat',
  'ML:East Khasi Hills': 'Shillong',
  'ML:Ri Bhoi': 'Nongpoh',
  'ML:East Jaintia Hills': 'Khliehriat',
  'ML:West Jaintia Hills': 'Jowai',
  'ML:West Khasi Hills': 'Nongstoin',
  'ML:South West Khasi Hills': 'Mawkyrwat',
  'ML:East Garo Hills': 'Williamnagar',
  'ML:West Garo Hills': 'Tura',
  'ML:South Garo Hills': 'Baghmara',
  'ML:North Garo Hills': 'Resubelpara',
  'ML:South West Garo Hills': 'Ampati',
  'MZ:Saiha': 'Saiha',
  'CG:Dantewada (South Bastar)': 'Dantewada',
  'CG:Kabirdham (Kawardha)': 'Kawardha',
  'CG:Kanker (North Bastar)': 'Kanker',
  'CG:Korea (Koriya)': 'Baikunthpur',
  'CG:Gariyaband': 'Gariaband',
  'CG:Janjgir-Champa': 'Janjgir',
  'HP:Lahaul & Spiti': 'Keylong',
  'HP:Kinnaur': 'Reckong Peo',
  'HP:Sirmaur': 'Nahan',
  'BR:Kaimur (Bhabua)': 'Bhabua',
  'BR:East Champaran (Motihari)': 'Motihari',
  'BR:West Champaran': 'Bettiah',
  'BR:Munger (Monghyr)': 'Munger',
  'BR:Purnia (Purnea)': 'Purnia',
  'BR:Saran': 'Chhapra',
  'BR:Sheikhpura': 'Sheikhpura',
  'JH:Seraikela-Kharsawan': 'Seraikela',
  'JH:East Singhbhum': 'Jamshedpur',
  'JH:West Singhbhum': 'Chaibasa',
  'JH:Sahibganj': 'Sahibganj',
  'PB:Sahibzada Ajit Singh Nagar': 'Mohali',
  'PB:Shahid Bhagat Singh Nagar': 'Nawanshahr',
  'PB:Rupnagar': 'Rupnagar',
  'PB:Muktsar': 'Sri Muktsar Sahib',
  'PB:Fatehgarh Sahib': 'Fatehgarh Sahib',
  'HR:Gurugram': 'Gurugram',
  'MP:Agar Malwa': 'Agar',
  'MP:Hoshangabad': 'Hoshangabad',
};

interface Hit {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLACE_TYPES = new Set(['city', 'town', 'village', 'municipality', 'suburb', 'hamlet', 'locality', 'borough']);

async function search(q: string): Promise<Hit[]> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'in', 'accept-language': 'en' })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'ecomkit-seed/1.0 (one-off district HQ table; contact hello@wodo.digital)' }, signal: AbortSignal.timeout(20000) });
    if (res.ok) return (await res.json()) as Hit[];
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`geocoder kept failing for "${q}"`);
}

async function main() {
  const rows = await readSheet();
  const table = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { records: Record<string, unknown> }) : { records: {} };
  const records = table.records as Record<string, { lat: number; lng: number; status: string; matched: string }>;
  const jobs = rows.map((r) => {
    const st = stateFromSheet(r.state)!;
    const c = canonicalDistrict(r.district, st.code);
    return { key: `${st.code}:${r.district}`, stateName: st.name, name: c.name, st: st.code, sheet: r.district };
  });
  jobs.push({ key: 'KA:Vijayanagara', stateName: 'Karnataka', name: 'Vijayanagara', st: 'KA', sheet: 'Vijayanagara' });
  let done = 0;
  for (const j of jobs) {
    if (ONLY && j.st !== ONLY) continue;
    if (records[j.key]?.status === 'manual' || (records[j.key] && !process.argv.includes('--redo'))) continue;
    const town = HQ_TOWN[`${j.st}:${j.name}`] ?? HQ_TOWN[`${j.st}:${j.sheet}`] ?? j.name;
    let hits = await search(`${town}, ${j.stateName}, India`);
    await sleep(1100);
    let inState = hits.filter((h) => h.display_name.includes(j.stateName));
    if (!inState.length) {
      hits = await search(`${town} district, ${j.stateName}, India`);
      await sleep(1100);
      inState = hits.filter((h) => h.display_name.includes(j.stateName));
    }
    const pick = inState.find((h) => PLACE_TYPES.has(h.type ?? '')) ?? inState[0];
    if (pick) {
      const townPick = PLACE_TYPES.has(pick.type ?? '');
      records[j.key] = { lat: +Number(pick.lat).toFixed(4), lng: +Number(pick.lon).toFixed(4), status: townPick ? 'verified' : 'check', matched: pick.display_name.slice(0, 120) };
    } else {
      console.warn(`no result: ${j.key} (${town})`);
    }
    if (++done % 25 === 0) {
      writeFileSync(OUT, JSON.stringify({ ...table, records }, null, 2));
      console.log(`${done} geocoded`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        version: 1,
        source: 'OpenStreetMap Nominatim, queried once for each district headquarters town',
        attribution: 'Data (c) OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright',
        records: sorted,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${Object.keys(sorted).length} entries to ${OUT}`);
}
await main();
