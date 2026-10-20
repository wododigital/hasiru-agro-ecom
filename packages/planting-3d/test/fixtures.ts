import type { PlanLayout, PlanPoint, Role } from '@ecomkit/core/contracts';
import type { PlantHint } from '../src/domain';

export const ID = { a: 'p-a', b: 'p-b', c: 'p-c', d: 'p-d', e: 'p-e' } as const;
export const hints: Record<string, PlantHint> = {
  [ID.a]: { name: 'Fixture Mango', canopy: 'large_tree', group: 'fruit' },
  [ID.b]: { name: 'Fixture Timber', canopy: 'large_tree', group: 'timber' },
  [ID.c]: { name: 'Fixture Shrub', canopy: 'shrub', group: 'other' },
  [ID.d]: { name: 'Fixture Banana', canopy: null, group: 'other' },
  [ID.e]: { name: 'Fixture Guava', canopy: 'small_tree', group: 'fruit' },
};
const forRole: Record<Role, string[]> = { M: [ID.a, ID.e], X: [ID.b], O: [ID.c, ID.d] };

export function layoutFrom(modelSlug: string, plant: number, row: number, rows: string[], block = { w: 36, h: 36 }): PlanLayout {
  const points: PlanPoint[] = [];
  const seen: Record<Role, number> = { M: 0, X: 0, O: 0 };
  for (let r = 0; r * row < block.h; r++) {
    const pattern = rows[r % rows.length]!;
    for (let c = 0; c * plant < block.w; c++) {
      const role = pattern[c % pattern.length] as Role;
      const ids = forRole[role];
      const productId = ids[seen[role]++ % ids.length]!;
      points.push({ x: c * plant, y: r * row, role, productId, label: `label ${productId}` });
    }
  }
  const perBlock = { M: 0, X: 0, O: 0 };
  for (const p of points) perBlock[p.role] += 1;
  return {
    modelSlug,
    modelName: modelSlug,
    blockFt: block,
    spacingFt: { plant, row },
    points,
    perBlock,
    blocks: 1,
    totalPlants: points.length,
    legend: (['M', 'X', 'O'] as const).map((role) => ({ role, productIds: forRole[role], perBlock: perBlock[role] })),
    boundaryFt: null,
  };
}

/** Commercial: 6 ft along the row, 12 ft between rows, 18 per 36 x 36 ft block. */
export const commercial = layoutFrom('commercial', 6, 12, ['MOXOXO']);
export const foodForest = layoutFrom('food-forest', 6, 6, ['MOXOMO', 'OXOXOX']);
export const miyawaki = layoutFrom('miyawaki', 3, 3, ['MXOXOO', 'XOOXOM', 'OXMOXO']);
/** Boundary: one line, a block with no depth. */
export const boundary: PlanLayout = { ...layoutFrom('boundary', 10, 10, ['XOXO'], { w: 100, h: 10 }), blockFt: { w: 100, h: 0 } };
