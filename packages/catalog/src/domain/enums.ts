// Enum values shared by the schema, zod inputs and the admin form (one list each).
export const KINDS = ['plant', 'input'] as const;
export const STATUSES = ['draft', 'active', 'archived'] as const;
export const SIZE_CLASSES = ['L', 'M', 'S'] as const;
export const CANOPIES = ['large_tree', 'medium_tree', 'small_tree', 'shrub', 'climber'] as const;
export const PROPAGATIONS = ['seeded', 'grafted', 'air_layered', 'cuttings', 'suckers', 'tissue_culture', 'other'] as const;
export const LEVELS = ['low', 'moderate', 'high'] as const;
export const WATER_NEEDS = ['low', 'medium', 'high'] as const;
export const EXPOSURES = ['full_sun', 'partial_shade', 'shade'] as const;
export const AVAILABILITY_OVERRIDES = ['available', 'out_of_stock', 'temporarily_unavailable', 'coming_soon', 'hidden'] as const;
export const TAG_KINDS = ['trait', 'use', 'filter'] as const;
export const FAQ_STATUSES = ['answered', 'ai_draft', 'client_only', 'published'] as const;
export const MEDIA_ROLES = ['main', 'gallery', 'fruit', 'plant', 'as_delivered', 'video_poster'] as const;
export const RELATIONS = ['companion', 'alternative', 'input_for'] as const;
/** Planting model keys that carry spacing on a product (area models use [L, W], line models one number). */
export const AREA_MODELS = ['food_forest', 'miyawaki', 'commercial'] as const;
export const LINE_MODELS = ['boundary'] as const;

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type SizeClass = (typeof SIZE_CLASSES)[number];
export type Canopy = (typeof CANOPIES)[number];
export type Propagation = (typeof PROPAGATIONS)[number];
export type Level = (typeof LEVELS)[number];
export type WaterNeed = (typeof WATER_NEEDS)[number];
export type Exposure = (typeof EXPOSURES)[number];
export type AvailabilityOverride = (typeof AVAILABILITY_OVERRIDES)[number];
export type TagKind = (typeof TAG_KINDS)[number];
export type FaqStatus = (typeof FAQ_STATUSES)[number];
export type MediaRole = (typeof MEDIA_ROLES)[number];
export type Relation = (typeof RELATIONS)[number];
