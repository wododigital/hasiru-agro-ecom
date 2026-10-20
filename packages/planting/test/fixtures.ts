// Model fixtures mirroring data/seed/models.json (brand-neutral placeholders for product ids and names).
import type { Member, ModelWithMembers, Role } from '../src/domain';

export const pid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const members = (spec: [number, Role][]): Member[] => spec.map(([n, role], i) => ({ productId: pid(n), role, spacingFt: [18, 18], position: i + 1, isDefaultPick: false }));

const base = { nameKn: null, descriptionHtml: null, legend: { M: 'Main', X: 'Host', O: 'Biomass' }, weightOverrideKg: null, isActive: true };

export const commercial: ModelWithMembers = {
  ...base,
  slug: 'commercial',
  name: 'Commercial',
  blockFt: { w: 36, h: 36 },
  spacingFt: { plant: 6, row: 12 },
  pattern: { kind: 'rows', rows: ['MOXOXOM'] },
  position: 1,
  members: members([
    [1, 'M'],
    [2, 'M'],
    [3, 'X'],
    [4, 'X'],
    [5, 'O'],
    [6, 'O'],
    [7, 'O'],
  ]),
};

export const foodForest: ModelWithMembers = {
  ...base,
  slug: 'food-forest',
  name: 'Food Forest',
  blockFt: { w: 36, h: 36 },
  spacingFt: { plant: 6, row: 6 },
  pattern: { kind: 'rows', rows: ['MOXOMOX', 'OXOXOXO'] },
  position: 2,
  members: members([
    [1, 'M'],
    [3, 'X'],
    [5, 'O'],
  ]),
};

export const miyawaki: ModelWithMembers = {
  ...base,
  slug: 'miyawaki',
  name: 'Miyawaki',
  blockFt: { w: 36, h: 36 },
  spacingFt: { plant: 2, row: 2 },
  pattern: { kind: 'random', mix: { M: 0.1, X: 0.5, O: 0.4 }, seed: 42 },
  weightOverrideKg: 0.8,
  position: 3,
  members: members([
    [1, 'M'],
    [3, 'X'],
    [5, 'O'],
  ]),
};

export const boundary: ModelWithMembers = {
  ...base,
  slug: 'boundary',
  name: 'Boundary',
  blockFt: { w: 36, h: 0 },
  spacingFt: { plant: 10, row: 0 },
  pattern: { kind: 'line', rows: ['MOXO'] },
  position: 4,
  members: members([
    [1, 'M'],
    [3, 'X'],
    [5, 'O'],
  ]),
};

export const ALL_MODELS = [commercial, foodForest, miyawaki, boundary];
