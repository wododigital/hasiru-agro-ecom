import { describe, expect, it } from 'vitest';
import { assignSlugs, canonicalDistrict, noDashes, parseList, soilTags, stateFromSheet } from '../src/domain';

describe('district name normalisation', () => {
  it.each([
    ['Mysore', 'Mysuru'],
    ['Raicur', 'Raichur'],
    ['Kodugu', 'Kodagu'],
    ['Karwar', 'Uttara Kannada'],
    ['Bijapur', 'Vijayapura'],
    ['Tumkur', 'Tumakuru'],
    ['Chikmagaluru', 'Chikkamagaluru'],
    ['Chikballapur', 'Chikkaballapura'],
  ])('Karnataka sheet spelling %s becomes %s and keeps the old spelling as an alias', (sheet, canonical) => {
    const c = canonicalDistrict(sheet, 'KA');
    expect(c.name).toBe(canonical);
    expect(c.aliases).toContain(sheet);
    expect(c.renamed).toBe(true);
  });

  it('moves a bracketed name to an alias', () => {
    const c = canonicalDistrict('Ballari (Bellary)', 'KA');
    expect(c).toMatchObject({ name: 'Ballari', renamed: true });
    expect(c.aliases).toEqual(expect.arrayContaining(['Bellary', 'Ballari (Bellary)']));
    expect(canonicalDistrict('Belagavi (Belgaum)', 'KA').aliases).toContain('Belgaum');
  });

  it('does not rename Bijapur in Chhattisgarh (a different district)', () => {
    expect(canonicalDistrict('Bijapur', 'CG')).toMatchObject({ name: 'Bijapur', aliases: [] });
  });

  it('leaves plain names alone and never lists the canonical name as its own alias', () => {
    expect(canonicalDistrict('Hassan', 'KA')).toEqual({ name: 'Hassan', aliases: [], renamed: false });
    for (const [raw, st] of [['Kodugu', 'KA'], ['Mysore', 'KA'], ['Paschim (West) Burdwan (Bardhaman)', 'WB']] as const) {
      const c = canonicalDistrict(raw, st);
      expect(c.aliases.map((a) => a.toLowerCase())).not.toContain(c.name.toLowerCase());
    }
  });

  it('resolves the sheet and India Post state spellings', () => {
    expect(stateFromSheet('TAMILNADU')?.code).toBe('TN');
    expect(stateFromSheet('ORISSA')?.code).toBe('OD');
    expect(stateFromSheet('THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU')?.code).toBe('DH');
    expect(stateFromSheet('KARNATAKA')?.gstStateCode).toBe('29');
    expect(stateFromSheet('Atlantis')).toBeNull();
  });
});

describe('slugs', () => {
  it('uses the plain name, and the state code on every colliding name', () => {
    const slugs = assignSlugs([
      { name: 'Hassan', stateCode: 'KA' },
      { name: 'Bilaspur', stateCode: 'CG' },
      { name: 'Bilaspur', stateCode: 'HP' },
      { name: 'Dakshina Kannada', stateCode: 'KA' },
    ]);
    expect(slugs).toEqual(['hassan', 'bilaspur-cg', 'bilaspur-hp', 'dakshina-kannada']);
  });
});

describe('soil and list parsing', () => {
  it('removes em and en dashes', () => {
    expect(noDashes('Red \u2013 loamy soil')).toBe('Red, loamy soil');
    expect(noDashes('the Ganges\u2013Ghaghara doab')).toBe('the Ganges-Ghaghara doab');
  });

  it('maps soil text to the keyword tags', () => {
    expect(soilTags('Red sandy soil, Red silty-clayey soil, Mixed soil, and Black soil').sort()).toEqual(['black', 'clay', 'red', 'sandy']);
    expect(soilTags('Laterite soil on the coastal plains, hilly in the east').sort()).toEqual(['coastal', 'hill', 'laterite']);
    expect(soilTags('Alluvial loam')).toEqual(['alluvial', 'loamy']);
    expect(soilTags('')).toEqual([]);
  });

  it('splits crops and rivers, dropping NA and "and"', () => {
    expect(parseList('Groundnut, cotton, maize, bajra, wheat, sugarcane, and tobacco')).toEqual(['groundnut', 'cotton', 'maize', 'bajra', 'wheat', 'sugarcane', 'tobacco']);
    expect(parseList('Thungabhadra River, hageri River', { lower: false })).toEqual(['Thungabhadra River', 'hageri River']);
    expect(parseList('NA')).toEqual([]);
    expect(parseList(null)).toEqual([]);
  });
});
