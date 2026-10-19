import { describe, expect, it } from 'vitest';
import { computeFit, countFitting, isNativeCrop, meetsPageRule, MIN_FITTING_PLANTS, rankFits } from '../src/domain';
import { COLD_HILLS, DRY_PLATEAU, HASSAN, WET_COAST, plant } from './fixtures';

describe('climate fit', () => {
  it('is good when temperature, rain and humidity are inside the plant range', () => {
    const fit = computeFit(HASSAN, plant());
    expect(fit.level).toBe('good');
    expect(fit.reasons).toEqual([]);
  });

  it('allows 2 C of slack either side and marks 2 to 5 C beyond that as ok', () => {
    // Hassan max 35; plant max 31 + 2 slack = 33, so 2 C over: marginal.
    const fit = computeFit(HASSAN, plant({ tempC: { min: 15, max: 31, opt: 25 } }));
    expect(fit.level).toBe('ok');
    expect(fit.reasons).toContain('fit.temp_marginal_hot');
    // exactly at the slack edge is still good: plant max 33 + 2 = 35
    expect(computeFit(HASSAN, plant({ tempC: { min: 15, max: 33, opt: 25 } })).level).toBe('good');
  });

  it('is not recommended when temperature is more than 5 C outside the slack', () => {
    const hot = computeFit(HASSAN, plant({ tempC: { min: 10, max: 26, opt: 20 } })); // 35 - 28 = 7 over
    expect(hot).toMatchObject({ level: 'not_recommended', score: 0 });
    expect(hot.reasons).toContain('fit.too_hot');
    const cold = computeFit(COLD_HILLS, plant());
    expect(cold.level).toBe('not_recommended');
    expect(cold.reasons).toContain('fit.too_cold');
  });

  it('asks for irrigation below the minimum rainfall', () => {
    const fit = computeFit(DRY_PLATEAU, plant({ rainfallMm: { min: 800, max: 2500 } })); // 562 >= 40% of 800
    expect(fit.level).toBe('ok');
    expect(fit.reasons).toContain('fit.needs_irrigation');
  });

  it('softens the dry rule for drought tolerant plants', () => {
    const fit = computeFit(DRY_PLATEAU, plant({ rainfallMm: { min: 700, max: 2500 }, droughtTolerance: 'high' })); // 562 >= 70% of 700
    expect(fit.level).toBe('good');
    expect(fit.reasons).toContain('fit.light_irrigation');
    const harsher = computeFit(DRY_PLATEAU, plant({ rainfallMm: { min: 1000, max: 2500 }, droughtTolerance: 'high' }));
    expect(harsher.level).toBe('ok');
  });

  it('rejects a plant far too dry for it unless it is drought tolerant', () => {
    const arid = { ...DRY_PLATEAU, climate: { ...DRY_PLATEAU.climate, rain_mm: 200 } };
    expect(computeFit(arid, plant({ rainfallMm: { min: 1000, max: 2500 }, droughtTolerance: 'low' })).level).toBe('not_recommended');
    expect(computeFit(arid, plant({ rainfallMm: { min: 1000, max: 2500 }, droughtTolerance: 'high' })).level).toBe('ok');
  });

  it('flags waterlogging above 1.2x the maximum and rejects above 2x', () => {
    const wet = computeFit(WET_COAST, plant({ rainfallMm: { min: 1500, max: 3500 } })); // 3900 > 4200? no -> fine
    expect(wet.level).toBe('good');
    const soggy = computeFit(WET_COAST, plant({ rainfallMm: { min: 500, max: 3000 } })); // 3900 > 3600
    expect(soggy.level).toBe('ok');
    expect(soggy.reasons).toContain('fit.waterlogging_risk');
    const drowned = computeFit(WET_COAST, plant({ rainfallMm: { min: 300, max: 1500 } })); // 3900 > 3000
    expect(drowned.level).toBe('not_recommended');
    expect(drowned.reasons).toContain('fit.too_wet');
  });

  it('treats humidity as a soft signal: a non-overlapping range only drops good to ok', () => {
    const fit = computeFit(WET_COAST, plant({ humidityPct: { min: 20, max: 50, opt: 35 }, rainfallMm: { min: 500, max: 4000 } }));
    expect(fit.level).toBe('ok');
    expect(fit.reasons).toContain('fit.humidity_mismatch');
  });

  it('adds soil and native crop reasons and a score bonus without changing the level', () => {
    const base = computeFit(HASSAN, plant({ names: ['Jackfruit'] }));
    const boosted = computeFit(HASSAN, plant({ names: ['Coffee'], soilTags: ['red'] }));
    expect(boosted.level).toBe(base.level);
    expect(boosted.reasons).toEqual(expect.arrayContaining(['fit.native_crop', 'fit.soil_match']));
    expect(boosted.score).toBe(base.score + 15);
  });

  it('skips a rule when the plant has no data for it', () => {
    const fit = computeFit(COLD_HILLS, { tempC: null, rainfallMm: null, humidityPct: null, soilTags: [] });
    expect(fit.level).toBe('good');
  });

  it('matches native crops on whole words only', () => {
    expect(isNativeCrop(['Pepper'], ['black pepper', 'coffee'])).toBe(true);
    expect(isNativeCrop(['Pea'], ['peanut'])).toBe(false);
    expect(isNativeCrop(['Jack'], [])).toBe(false);
    expect(isNativeCrop(undefined, ['coffee'])).toBe(false);
  });
});

describe('ranking and the 6+ rule', () => {
  const plants = [
    { plant: plant({ names: ['Mango'] }), item: 'mango' },
    { plant: plant({ names: ['Coffee'] }), item: 'coffee' },
    { plant: plant({ tempC: { min: 10, max: 26, opt: 20 } }), item: 'too-hot' },
    { plant: plant({ rainfallMm: { min: 3000, max: 5000 } }), item: 'dry-wants-more' },
  ];

  it('drops not_recommended plants and sorts best score first', () => {
    const ranked = rankFits(HASSAN, plants);
    expect(ranked.map((r) => r.item)).toEqual(['coffee', 'mango']);
    expect(ranked.every((r) => r.fit.level !== 'not_recommended')).toBe(true);
  });

  it('counts good and ok as fitting and needs six', () => {
    expect(MIN_FITTING_PLANTS).toBe(6);
    const mk = (n: number) => Array.from({ length: n }, () => ({ level: 'good' as const }));
    expect(meetsPageRule(mk(5))).toBe(false);
    expect(meetsPageRule(mk(6))).toBe(true);
    expect(meetsPageRule([...mk(3), ...Array.from({ length: 3 }, () => ({ level: 'ok' as const }))])).toBe(true);
    expect(meetsPageRule([...mk(5), { level: 'not_recommended' as const }])).toBe(false);
    expect(countFitting([{ level: 'ok' }, { level: 'not_recommended' }])).toBe(1);
  });
});
