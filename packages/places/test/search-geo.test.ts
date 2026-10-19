import { describe, expect, it } from 'vitest';
import type { DistrictRef } from '@ecomkit/core/contracts';
import { buildIndex, fold, haversineKm, nearest, roadDistanceKm, suggestDistricts } from '../src/domain';

const ref = (slug: string, name: string, stateCode: string, stateName: string, distanceKm: number | null): DistrictRef => ({
  slug, name, stateCode, stateName, gstStateCode: '29', distanceKm, lat: null, lng: null,
});
const index = buildIndex([
  { district: ref('mysuru', 'Mysuru', 'KA', 'Karnataka', 150), aliases: ['Mysore'] },
  { district: ref('raichur', 'Raichur', 'KA', 'Karnataka', 400), aliases: ['Raicur'] },
  { district: ref('bengaluru-urban', 'Bengaluru Urban', 'KA', 'Karnataka', 0), aliases: ['Bangalore Urban', 'Bangalore'] },
  { district: ref('bengaluru-rural', 'Bengaluru Rural', 'KA', 'Karnataka', 30), aliases: ['Bangalore Rural'] },
  { district: ref('hassan', 'Hassan', 'KA', 'Karnataka', 185), aliases: [] },
  { district: ref('chennai', 'Chennai', 'TN', 'Tamil Nadu', 350), aliases: [] },
  { district: ref('tumakuru', 'Tumakuru', 'KA', 'Karnataka', 70), aliases: ['Tumkur'] },
  { district: ref('aurangabad-br', 'Aurangabad', 'BR', 'Bihar', null), aliases: [] },
]);

describe('typeahead', () => {
  it('needs two characters', () => {
    expect(suggestDistricts(index, 'm')).toEqual([]);
    expect(suggestDistricts(index, ' m ')).toEqual([]);
    expect(suggestDistricts(index, 'my')[0]?.district.slug).toBe('mysuru');
  });

  it('finds a district by its old spelling and labels the hit as an alias', () => {
    const [hit] = suggestDistricts(index, 'Mysore');
    expect(hit).toMatchObject({ kind: 'alias', label: 'Mysuru, Karnataka' });
    expect(suggestDistricts(index, 'raicur')[0]?.district.slug).toBe('raichur');
    expect(suggestDistricts(index, 'tumk')[0]?.district.slug).toBe('tumakuru');
  });

  it('puts the exact name first and breaks prefix ties by distance from the nursery', () => {
    expect(suggestDistricts(index, 'bangalore').map((s) => s.district.slug)).toEqual(['bengaluru-urban', 'bengaluru-rural']);
    expect(suggestDistricts(index, 'beng').map((s) => s.district.slug)).toEqual(['bengaluru-urban', 'bengaluru-rural']);
    expect(suggestDistricts(index, 'hassan')[0]?.kind).toBe('district');
  });

  it('matches the state name and ignores case, accents and punctuation', () => {
    expect(suggestDistricts(index, 'tamil').map((s) => s.district.slug)).toEqual(['chennai']);
    expect(suggestDistricts(index, 'MYSŪRU!')[0]?.district.slug).toBe('mysuru');
    expect(suggestDistricts(index, 'mysūru'.normalize('NFD'))[0]?.district.slug).toBe('mysuru');
    expect(fold('  Dakshina-Kannada ')).toBe('dakshina kannada');
  });

  it('respects the limit and returns nothing for no match', () => {
    expect(suggestDistricts(index, 'ka', 2).length).toBeLessThanOrEqual(2);
    expect(suggestDistricts(index, 'zzzz')).toEqual([]);
  });
});

describe('geo', () => {
  const bengaluru = { lat: 12.9716, lng: 77.5946 };
  const mysuru = { lat: 12.2958, lng: 76.6394 };

  it('haversine matches a known city pair within 2 percent', () => {
    expect(haversineKm(bengaluru, mysuru)).toBeGreaterThan(125);
    expect(haversineKm(bengaluru, mysuru)).toBeLessThan(130);
    expect(haversineKm(bengaluru, bengaluru)).toBe(0);
  });

  it('road distance is the straight line x 1.3 rounded to 5 km', () => {
    const km = roadDistanceKm(bengaluru, mysuru);
    expect(km % 5).toBe(0);
    expect(km).toBe(Math.round((haversineKm(bengaluru, mysuru) * 1.3) / 5) * 5);
    expect(km).toBeGreaterThanOrEqual(160);
    expect(km).toBeLessThanOrEqual(170);
  });

  it('finds the nearest point', () => {
    const pts = [{ ...mysuru, id: 'mysuru' }, { lat: 13.0827, lng: 80.2707, id: 'chennai' }];
    expect(nearest({ lat: 12.5, lng: 77 }, pts)?.id).toBe('mysuru');
    expect(nearest({ lat: 12.5, lng: 77 }, [])).toBeNull();
  });
});
