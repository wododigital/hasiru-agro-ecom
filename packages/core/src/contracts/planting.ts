/** M = main, X = host, O = biomass (legend labels come from messages). */
export type Role = 'M' | 'X' | 'O';
export const ROLES: readonly Role[] = ['M', 'X', 'O'];

export interface PlanPoint {
  /** Feet from the block origin. */
  x: number;
  y: number;
  role: Role;
  productId: string;
  label: string;
}

/** Produced by `@ecomkit/planting`, consumed by the SVG plan, planting-3d and the assistant. */
export interface PlanLayout {
  modelSlug: string;
  modelName: string;
  /** The repeating block (36 x 36 ft for area models; a line segment for Boundary). */
  blockFt: { w: number; h: number };
  spacingFt: { plant: number; row: number };
  points: readonly PlanPoint[];
  /** Per-block counts with half-open edges [0, w) so edge plants are not double counted. */
  perBlock: Readonly<Record<Role, number>>;
  /** Area models: landSqft / (w x h). Boundary: boundaryFt / spacing. */
  blocks: number;
  totalPlants: number;
  legend: readonly { role: Role; productIds: readonly string[]; perBlock: number }[];
  boundaryFt: number | null;
}
