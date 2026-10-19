// Climate fit rules (research product-data section 9, uses 2). The rules decide; nothing here calls a model.
import type { ClimateFit, FitLevel, PlantClimate } from '@ecomkit/core/contracts';
import type { DistrictClimate } from './types';

/** A plant's climate plus the optional signals the rules can use. Structurally a `PlantClimate`. */
export interface FitInput extends PlantClimate {
  droughtTolerance?: 'low' | 'moderate' | 'high' | null;
  /** Names the plant is known by (base name, species); matched against the district's native crops. */
  names?: readonly string[];
}

export interface DistrictFitData {
  climate: DistrictClimate;
  soilTags: readonly string[];
  nativeCrops: readonly string[];
}

/** `ClimateFit` plus a 0..110 score for ordering plants on a district page. */
export interface ScoredFit extends ClimateFit {
  score: number;
}

/** Tolerances in one place so the admin-facing docs and the tests quote the same numbers. */
export const FIT_RULES = {
  /** Degrees C outside the plant's range that still counts as fine. */
  tempSlack: 2,
  /** Degrees C outside the slack beyond which the plant is not recommended. */
  tempHardFail: 5,
  /** Rain above max x this still counts as fine. */
  rainHeadroom: 1.2,
  /** Rain below min x this (and not drought tolerant) is not recommended. */
  rainTooDry: 0.4,
  /** Rain above max x this is not recommended. */
  rainTooWet: 2,
  /** Drought-tolerant plants below min only need light irrigation down to min x this. */
  droughtSoft: 0.7,
} as const;

const RANK: Record<FitLevel, number> = { good: 2, ok: 1, not_recommended: 0 };
const worse = (a: FitLevel, b: FitLevel): FitLevel => (RANK[a] <= RANK[b] ? a : b);

/** True when the plant's name or species appears among the district's native crops. */
export function isNativeCrop(names: readonly string[] | undefined, nativeCrops: readonly string[]): boolean {
  if (!names?.length || !nativeCrops.length) return false;
  const crops = nativeCrops.map((c) => c.toLowerCase());
  return names.some((n) => {
    const name = n.toLowerCase().trim();
    return name.length > 2 && crops.some((c) => c === name || new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c));
  });
}

export function computeFit(district: DistrictFitData, plant: FitInput): ScoredFit {
  const d = district.climate;
  const reasons: string[] = [];
  let level: FitLevel = 'good';
  const tolerant = plant.droughtTolerance === 'high';

  if (plant.tempC) {
    const cold = plant.tempC.min - FIT_RULES.tempSlack - d.temp_min;
    const hot = d.temp_max - (plant.tempC.max + FIT_RULES.tempSlack);
    const excess = Math.max(cold, hot, 0);
    if (excess > FIT_RULES.tempHardFail) {
      level = 'not_recommended';
      reasons.push(cold >= hot ? 'fit.too_cold' : 'fit.too_hot');
    } else if (excess > 0) {
      level = worse(level, 'ok');
      reasons.push(cold >= hot ? 'fit.temp_marginal_cold' : 'fit.temp_marginal_hot');
    }
  }

  if (plant.rainfallMm) {
    const { min, max } = plant.rainfallMm;
    if (d.rain_mm < min) {
      if (!tolerant && d.rain_mm < min * FIT_RULES.rainTooDry) {
        level = 'not_recommended';
        reasons.push('fit.too_dry');
      } else if (tolerant && d.rain_mm >= min * FIT_RULES.droughtSoft) {
        reasons.push('fit.light_irrigation');
      } else {
        level = worse(level, 'ok');
        reasons.push('fit.needs_irrigation');
      }
    } else if (d.rain_mm > max * FIT_RULES.rainTooWet) {
      level = 'not_recommended';
      reasons.push('fit.too_wet');
    } else if (d.rain_mm > max * FIT_RULES.rainHeadroom) {
      level = worse(level, 'ok');
      reasons.push('fit.waterlogging_risk');
    }
  }

  if (plant.humidityPct) {
    const overlap = d.humidity_min <= plant.humidityPct.max && d.humidity_max >= plant.humidityPct.min;
    if (!overlap) {
      level = worse(level, 'ok');
      reasons.push('fit.humidity_mismatch');
    }
  }

  let bonus = 0;
  if (plant.soilTags.length && plant.soilTags.some((t) => district.soilTags.includes(t))) {
    reasons.push('fit.soil_match');
    bonus += 5;
  }
  if (isNativeCrop(plant.names, district.nativeCrops)) {
    reasons.push('fit.native_crop');
    bonus += 10;
  }

  const base = level === 'good' ? 100 : level === 'ok' ? 60 : 0;
  return { level, reasons, score: level === 'not_recommended' ? 0 : base + bonus };
}

/** The plants on a district page: not_recommended removed, best score first, `good` count reported. */
export function rankFits<T>(
  district: DistrictFitData,
  plants: readonly { plant: FitInput; item: T }[],
): { item: T; fit: ScoredFit }[] {
  return plants
    .map(({ plant, item }) => ({ item, fit: computeFit(district, plant) }))
    .filter((r) => r.fit.level !== 'not_recommended')
    .sort((a, b) => b.fit.score - a.fit.score);
}

/** The 6+ rule: a district page is only worth indexing with at least this many fitting plants. */
export const MIN_FITTING_PLANTS = 6;

/** "Fitting" counts `good` and `ok` (ok means workable with irrigation or a marginal reading). */
export function countFitting(fits: readonly { level: FitLevel }[]): number {
  return fits.filter((f) => f.level !== 'not_recommended').length;
}

export function meetsPageRule(fits: readonly { level: FitLevel }[]): boolean {
  return countFitting(fits) >= MIN_FITTING_PLANTS;
}
