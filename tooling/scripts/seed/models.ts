// Step 9.5: the four planting models (HANDOFF placeholder patterns) and their member plants. A plant is a
// member of a model when the client gave it a spacing for that model; its role is the A12 default.
import { join } from 'node:path';
// @boundaries-ignore type-only: the seed-hook contract; @tooling/scripts cannot depend on core (core depends on it for db helpers)
import type { SeedContext } from '../../../packages/core/src/contracts/extensions';
import { once, SOURCES, writeSeedFile } from './lib/common';
import { buildProducts, type Role } from './fill-gaps';
import type { ModelKey } from './normalize-plants';

export interface ModelRecord {
  slug: string;
  name: string;
  description: string;
  kind: 'area' | 'line';
  block_ft: { w: number; h: number };
  spacing_ft: { plant: number; row: number };
  pattern: string[];
  mix: { M: number; X: number; O: number } | null;
  rng_seed: number | null;
  weight_override_kg: number | null;
  legend: { M: string; X: string; O: string };
  members: { sku: string; role: Role; sort: number }[];
  video: null;
  sort: number;
}

const LEGEND = { M: 'Main', X: 'Host', O: 'Biomass' };

const MODELS: (Omit<ModelRecord, 'members' | 'legend' | 'video'> & { key: ModelKey })[] = [
  {
    key: 'commercial', slug: 'commercial', name: 'Commercial',
    description: 'Rows of main fruit trees with host timber and biomass plants between them: 6 ft along the row, 12 ft between rows, each row M O X O X O M.',
    kind: 'area', block_ft: { w: 36, h: 36 }, spacing_ft: { plant: 6, row: 12 }, pattern: ['MOXOXOM'], mix: null, rng_seed: null, weight_override_kg: null, sort: 1,
  },
  {
    key: 'food_forest', slug: 'food-forest', name: 'Food Forest',
    description: 'A layered 6 x 6 ft grid of canopy, sub-canopy, shrub and biomass plants, alternating rows for a self-feeding forest garden.',
    kind: 'area', block_ft: { w: 36, h: 36 }, spacing_ft: { plant: 6, row: 6 }, pattern: ['MOXOMOX', 'OXOXOXO'], mix: null, rng_seed: null, weight_override_kg: null, sort: 2,
  },
  {
    key: 'miyawaki', slug: 'miyawaki', name: 'Miyawaki',
    description: 'A dense native mini-forest on a 2 x 2 ft grid, about 3 plants per square metre: roughly 10% canopy, 50% tree and 40% shrub layer, mixed at random.',
    kind: 'area', block_ft: { w: 36, h: 36 }, spacing_ft: { plant: 2, row: 2 }, pattern: [], mix: { M: 0.1, X: 0.5, O: 0.4 }, rng_seed: 42, weight_override_kg: 0.8, sort: 3,
  },
  {
    key: 'boundary', slug: 'boundary', name: 'Boundary',
    description: 'A single line of trees along the farm boundary as a windbreak and living fence.',
    kind: 'line', block_ft: { w: 36, h: 0 }, spacing_ft: { plant: 10, row: 0 }, pattern: ['MOXO'], mix: null, rng_seed: null, weight_override_kg: null, sort: 4,
  },
];

export const buildModels = once((): ModelRecord[] => {
  const plants = buildProducts().products.filter((p) => p.kind === 'plant' && p.status === 'active');
  return MODELS.map(({ key, ...m }) => {
    const members = plants
      .filter((p) => p.plant?.models[key])
      .map((p) => ({ sku: p.sku, role: p.plant!.models[key]!.role! }))
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((x, i) => ({ ...x, sort: i + 1 }));
    const { sort, ...head } = m;
    return { ...head, legend: LEGEND, members, video: null, sort }; // key order as in data/seed/SCHEMA.md
  }).sort((a, b) => a.slug.localeCompare(b.slug));
});

export default async function step(ctx: SeedContext): Promise<void> {
  const models = buildModels();
  writeSeedFile(join(ctx.seedDir, 'models.json'), [SOURCES.xlsx, SOURCES.handoff], models, ctx);
  ctx.log.info(`models: ${models.map((m) => `${m.slug} ${m.members.length}`).join(', ')}`);
}
