import { describe, expect, it } from 'vitest';
import {
  archetypeFor,
  buildViewerData,
  DEFAULT_PATCHES,
  patchPoints,
  patchRepeats,
  patchSpecFor,
  prefers2d,
  scaleBarFt,
  stickVector,
  sunLight,
  walkStep,
} from '../src/domain';
import { boundary, commercial, foodForest, hints, ID, layoutFrom, miyawaki } from './fixtures';

describe('patch from a PlanLayout', () => {
  it('Commercial 13 x 3: the 18-per-block pattern tiled along the row, clipped to the patch', () => {
    expect(commercial.points).toHaveLength(18);
    const { points, extent } = patchPoints(commercial, patchSpecFor('commercial'));
    expect(extent).toEqual({ w: 78, d: 36 });
    expect(points).toHaveLength(13 * 3);
    expect(Math.max(...points.map((p) => p.x))).toBe(72);
    // the cycling M O X O X O pattern carries on across the block edge
    expect(points.filter((p) => p.z === 0).map((p) => p.role).join('')).toBe('MOXOXOMOXOXOM');
  });

  it('Food Forest 7 x 7 and Miyawaki 7 x 7 at 0.45 scale (hyphen or underscore slug)', () => {
    expect(patchPoints(foodForest, patchSpecFor('food-forest')).points).toHaveLength(49);
    const spec = patchSpecFor('miyawaki');
    expect(spec).toEqual({ nx: 7, ny: 7, scale: 0.45 });
    const data = buildViewerData({ layout: miyawaki, hints }, spec);
    expect(data.points).toHaveLength(49);
    expect(data.scale).toBe(0.45);
    expect(data.raised).toBe(false);
  });

  it('a spacing that does not divide the block still gives an even grid (10 ft in a 36 ft block)', () => {
    const tenFt = layoutFrom('food-forest', 10, 10, ['MOXOMOX', 'OXOXOXO']);
    const { points, extent } = patchPoints(tenFt, { nx: 7, ny: 7, scale: 1 });
    expect(points).toHaveLength(49);
    expect(extent).toEqual({ w: 70, d: 70 });
    expect([...new Set(points.map((p) => p.x))]).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('Boundary: one line of plants', () => {
    const { points, extent } = patchPoints(boundary, DEFAULT_PATCHES.boundary!);
    expect(extent).toEqual({ w: 150, d: 10 });
    expect(points).toHaveLength(15);
    expect(new Set(points.map((p) => p.z))).toEqual(new Set([0]));
  });

  it('unknown models get the 7 x 7 fallback; overrides win', () => {
    expect(patchSpecFor('orchard')).toEqual({ nx: 7, ny: 7, scale: 1 });
    expect(patchSpecFor('Commercial', { commercial: { nx: 5, ny: 2, scale: 1 } })).toEqual({ nx: 5, ny: 2, scale: 1 });
  });

  it('viewer data: names and legend from the catalogue hints, caption numbers, raised rows when 10 ft apart', () => {
    const data = buildViewerData({ layout: commercial, hints, landSqft: 43_560 }, patchSpecFor('commercial'));
    expect(data.legend).toEqual([
      { role: 'M', names: ['Fixture Mango', 'Fixture Guava'] },
      { role: 'X', names: ['Fixture Timber'] },
      { role: 'O', names: ['Fixture Shrub', 'Fixture Banana'] },
    ]);
    expect(data.points[0]).toMatchObject({ x: 0, z: 0, role: 'M', name: 'Fixture Mango', archetype: 'large_fruit' });
    expect(data.raised).toBe(true);
    expect(data.repeats).toBe(Math.round(43_560 / (78 * 36)));
    // without hints the layout labels are used
    expect(buildViewerData({ layout: commercial }, patchSpecFor('commercial')).points[0]!.name).toBe(`label ${ID.a}`);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data); // plain data for the island props
  });

  it('patch repeats only when the land is known', () => {
    expect(patchRepeats(null, { w: 10, d: 10 })).toBeNull();
    expect(patchRepeats(10, { w: 10, d: 10 })).toBe(1);
  });
});

describe('archetypes', () => {
  it('hint, banana name, timber group, canopy, then role', () => {
    expect(archetypeFor({ name: 'X', archetype: 'shrub', group: 'timber' }, 'M')).toBe('shrub');
    expect(archetypeFor({ name: 'Banana G9', canopy: 'large_tree' }, 'O')).toBe('banana');
    expect(archetypeFor({ name: 'Teak', canopy: 'large_tree', group: 'timber' }, 'M')).toBe('timber');
    expect(archetypeFor({ name: 'Guava', canopy: 'small_tree' }, 'M')).toBe('small_fruit');
    expect(archetypeFor({ name: 'Moringa', canopy: 'shrub' }, 'X')).toBe('shrub');
    expect(archetypeFor({ name: 'Jackfruit', canopy: 'large_tree', group: 'fruit' }, 'X')).toBe('large_fruit');
    expect(archetypeFor({ name: 'Silver oak', canopy: 'medium_tree', group: 'other' }, 'X')).toBe('timber');
    expect(archetypeFor(undefined, 'M')).toBe('large_fruit');
    expect(archetypeFor(undefined, 'X')).toBe('timber');
    expect(archetypeFor(undefined, 'O')).toBe('shrub');
  });
});

describe('view, sun and walking', () => {
  it('2D by default under reduced motion or low device memory', () => {
    expect(prefers2d({ reducedMotion: true })).toBe(true);
    expect(prefers2d({ reducedMotion: false, deviceMemory: 2 })).toBe(true);
    expect(prefers2d({ reducedMotion: false, deviceMemory: 8 })).toBe(false);
    expect(prefers2d({ reducedMotion: false })).toBe(false);
  });

  it('sun slider rises from a warm low sun to a bright high one', () => {
    const low = sunLight(0);
    const high = sunLight(100);
    expect(low.elevation).toBeCloseTo((12 * Math.PI) / 180);
    expect(high.elevation).toBeCloseTo((78 * Math.PI) / 180);
    expect(low.warmth).toBe(1);
    expect(high.warmth).toBe(0);
    expect(high.intensity).toBeGreaterThan(low.intensity);
    expect(sunLight(500)).toEqual(high);
  });

  it('walking moves where the walker faces, turns, and stays inside the bounds', () => {
    const b = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    const fwd = walkStep({ x: 0, z: 0, yaw: 0 }, { forward: 1, strafe: 0, turn: 0 }, 0.05, b);
    expect(fwd.x).toBeCloseTo(0);
    expect(fwd.z).toBeCloseTo(-0.4); // 8 ft/s x 0.05 s, facing -z
    const strafe = walkStep({ x: 0, z: 0, yaw: 0 }, { forward: 0, strafe: 1, turn: 0 }, 0.05, b);
    expect(strafe.x).toBeCloseTo(0.4);
    expect(walkStep({ x: 0, z: 0, yaw: 0 }, { forward: 0, strafe: 0, turn: 1 }, 0.05, b).yaw).toBeCloseTo(0.08);
    // a long frame is capped at 50 ms; the wall stops the walker
    expect(walkStep({ x: 9.9, z: 0, yaw: 0 }, { forward: 0, strafe: 1, turn: 0 }, 2, b).x).toBe(10);
  });

  it('thumbstick vector is clipped to the stick radius; scale bar is a round number', () => {
    expect(stickVector(0, -42, 42)).toEqual({ x: 0, y: -1 });
    const v = stickVector(100, 0, 42);
    expect(v.x).toBeCloseTo(1);
    expect(stickVector(21, 0, 42)).toEqual({ x: 0.5, y: 0 });
    expect([scaleBarFt(10), scaleBarFt(36), scaleBarFt(150)]).toEqual([5, 10, 20]);
  });
});
