// Synthetic catalogue for size and speed tests: generic plant and input names (no store data), deterministic.
import { facetValuesFromProduct, type SearchSourceRow } from '../src/domain';

const BASES: [string, string, string, string[]][] = [
  ['Mango', 'ಮಾವು', 'Mangifera indica', ['aam', 'maavu']],
  ['Teak', 'ತೇಗ', 'Tectona grandis', ['saagwan', 'tega']],
  ['Mahogany', 'ಮಹಾಗನಿ', 'Swietenia macrophylla', ['mahagony']],
  ['Sapota', 'ಸಪೋಟ', 'Manilkara zapota', ['chikku', 'chiku', 'sapodilla']],
  ['Jackfruit', 'ಹಲಸು', 'Artocarpus heterophyllus', ['halasu', 'kathal']],
  ['Red Sandalwood', 'ರಕ್ತಚಂದನ', 'Pterocarpus santalinus', ['red sanders', 'raktachandana']],
  ['Guava', 'ಸೀಬೆ', 'Psidium guajava', ['seebe', 'amrood']],
  ['Coconut', 'ತೆಂಗು', 'Cocos nucifera', ['tengu', 'nariyal']],
  ['Neem', 'ಬೇವು', 'Azadirachta indica', ['bevu']],
  ['Jamun', 'ನೇರಳೆ', 'Syzygium cumini', ['nerale', 'java plum']],
  ['Avocado', 'ಬೆಣ್ಣೆಹಣ್ಣು', 'Persea americana', ['butter fruit']],
  ['Pepper', 'ಮೆಣಸು', 'Piper nigrum', ['kari menasu', 'black pepper']],
  ['Drumstick', 'ನುಗ್ಗೆ', 'Moringa oleifera', ['nugge', 'moringa']],
  ['Silver Oak', 'ಸಿಲ್ವರ್ ಓಕ್', 'Grevillea robusta', []],
  ['Tamarind', 'ಹುಣಸೆ', 'Tamarindus indica', ['hunase', 'imli']],
  ['Amla', 'ನೆಲ್ಲಿ', 'Phyllanthus emblica', ['nellikai', 'gooseberry']],
  ['Arecanut', 'ಅಡಿಕೆ', 'Areca catechu', ['adike', 'supari']],
  ['Lemon', 'ನಿಂಬೆ', 'Citrus limon', ['nimbe']],
  ['Pomegranate', 'ದಾಳಿಂಬೆ', 'Punica granatum', ['dalimbe', 'anar']],
  ['Cashew', 'ಗೇರು', 'Anacardium occidentale', ['geru']],
];
const VARIETIES = ['', 'Alphonso', 'Grafted', 'Dwarf', 'Hybrid', 'Native', 'Thai', 'Red', 'Giant', 'Early', 'Seedless', 'Malabar', 'Kesar', 'Sweet', 'Golden', 'Compact', 'Wild'];
const SIZES = ['L', 'M', 'S'];
const PROPS = ['grafted', 'seedling', 'tissue_culture', 'air_layered', 'budded'];
const MODELS = ['food_forest', 'miyawaki', 'commercial', 'boundary'];
const TAGS = ['native', 'fast_growing', 'medicinal', 'shade', 'bird_friendly', 'hedge', 'timber', 'fruit'];

/** Tiny seeded PRNG (mulberry32) so fixtures are identical on every run. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUIDv7-shaped ids (random enough to compress like real ones). */
function fakeId(r: () => number, i: number): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  return `019a${i.toString(16).padStart(4, '0')}-${hex(4)}-7${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export function syntheticRows(count = 350, seed = 7): SearchSourceRow[] {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  return Array.from({ length: count }, (_, i): SearchSourceRow => {
    const [base, local, sci, aliases] = BASES[i % BASES.length]!;
    const variety = VARIETIES[Math.floor(i / BASES.length) % VARIETIES.length]!;
    const isInput = i % 12 === 11;
    const name = isInput ? `${pick(['Vermicompost', 'Neem Cake', 'Biochar', 'Cocopeat', 'Bio Pesticide'])} ${i}` : variety ? `${base} ${variety}` : base;
    const tempMin = 5 + Math.floor(r() * 15);
    const known = r() > 0.15;
    return {
      productId: fakeId(r, i),
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`,
      kind: isInput ? 'input' : 'plant',
      name,
      nameLocal: isInput ? null : local,
      scientificName: isInput ? null : sci,
      aliases: isInput ? [] : aliases,
      facets: facetValuesFromProduct({
        kind: isInput ? 'input' : 'plant',
        sizeClass: isInput ? null : pick(SIZES),
        propagation: isInput || !known ? null : pick(PROPS),
        nitrogenFixer: isInput ? null : r() > 0.8,
        droughtTolerance: isInput ? null : pick(['low', 'moderate', 'high']),
        waterNeed: isInput ? null : pick(['low', 'moderate', 'high']),
        exposure: isInput || !known ? null : pick(['full_sun', 'partial_shade']),
        tempMin: isInput ? null : tempMin,
        tempMax: isInput ? null : tempMin + 20 + Math.floor(r() * 15),
        rainfallMin: isInput ? null : 400 + Math.floor(r() * 1200),
        rainfallMax: isInput ? null : 1600 + Math.floor(r() * 2000),
        bearingYearsMin: isInput || !known ? null : 1 + Math.floor(r() * 9),
        models: isInput ? null : MODELS.filter(() => r() > 0.5),
        tagSlugs: isInput ? [] : TAGS.filter(() => r() > 0.75),
        inStock: r() > 0.2,
      }),
      numeric: { price: (30 + Math.floor(r() * 2000)) * 100, bear: isInput ? null : 1 + Math.floor(r() * 9), newest: 20000 + Math.floor(r() * 500) },
    };
  });
}
