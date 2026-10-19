import { describe, expect, it } from 'vitest';
import { buildDistrictMatcher, cleanOfficeName, levenshtein, parseCsvLine } from '../src/domain';

const districts = [
  { slug: 'bengaluru-urban', name: 'Bengaluru Urban', state_code: 'KA', aliases: ['Bangalore Urban', 'Bangalore', 'Bengaluru'] },
  { slug: 'bengaluru-rural', name: 'Bengaluru Rural', state_code: 'KA', aliases: ['Bangalore Rural'] },
  { slug: 'mysuru', name: 'Mysuru', state_code: 'KA', aliases: ['Mysore'] },
  { slug: 'kodagu', name: 'Kodagu', state_code: 'KA', aliases: ['Kodugu', 'Coorg'] },
  { slug: 'uttara-kannada', name: 'Uttara Kannada', state_code: 'KA', aliases: ['Karwar'] },
  { slug: 'komaram-bheem-asifabad', name: 'Komaram Bheem Asifabad', state_code: 'TG', aliases: [] },
];
const matcher = buildDistrictMatcher(districts.map((d) => ({ slug: d.slug, name: d.name, stateCode: d.state_code, aliases: d.aliases })));

describe('pincode district matching', () => {
  it('matches India Post spellings through names and aliases', () => {
    expect(matcher.match('MYSORE', 'KA')).toEqual({ slug: 'mysuru', how: 'exact' });
    expect(matcher.match('BANGALORE', 'KA')?.slug).toBe('bengaluru-urban');
    expect(matcher.match('BANGALORE RURAL', 'KA')?.slug).toBe('bengaluru-rural');
    expect(matcher.match('COORG', 'KA')?.slug).toBe('kodagu');
  });
  it('falls back to edit distance for a small misspelling, and never crosses states', () => {
    expect(matcher.match('KUMURAM BHEEM ASIFABAD', 'TG')).toEqual({ slug: 'komaram-bheem-asifabad', how: 'fuzzy' });
    expect(matcher.match('MYSORE', 'TG')).toBeNull();
    expect(matcher.match('ATLANTIS', 'KA')).toBeNull();
    expect(matcher.match('', 'KA')).toBeNull();
  });
  it('helpers', () => {
    expect(levenshtein('kitten', 'sitting', 5)).toBe(3);
    expect(cleanOfficeName('Kothimir B.O')).toBe('Kothimir');
    expect(cleanOfficeName('Bangalore G.P.O.')).toBe('Bangalore');
    expect(parseCsvLine('"a, b",c,"d ""q"""')).toEqual(['a, b', 'c', 'd "q"']);
  });
});
