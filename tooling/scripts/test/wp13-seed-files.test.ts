import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { districtsFileSchema, hqTableSchema, licenceAllowedForTest } from './wp13-seed-files.helpers';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('data/seed/districts.json', () => {
  const file = districtsFileSchema.parse(JSON.parse(read('data/seed/districts.json')));
  const d = file.records.districts;
  const by = (slug: string) => d.find((x) => x.slug === slug)!;

  it('has every sheet row plus Vijayanagara, unique slugs and no dashes in text', () => {
    expect(d).toHaveLength(645);
    expect(new Set(d.map((x) => x.slug)).size).toBe(645);
    expect(JSON.stringify(file).match(/[—–]/g)).toBeNull();
    const states = new Set(file.records.states.map((s) => s.code));
    expect(d.every((x) => states.has(x.state_code))).toBe(true);
  });

  it('applies the plan 9.6 renames and aliases', () => {
    for (const [slug, alias] of [['mysuru', 'Mysore'], ['raichur', 'Raicur'], ['kodagu', 'Kodugu'], ['uttara-kannada', 'Karwar'], ['vijayapura', 'Bijapur'], ['tumakuru', 'Tumkur'], ['chikkamagaluru', 'Chikmagaluru'], ['chikkaballapura', 'Chikballapur'], ['ballari', 'Bellary']]) {
      expect(by(slug!).aliases, slug).toContain(alias);
    }
    expect(by('vijayanagara').data_source).toBe('derived');
    expect(by('vijayanagara').climate).toEqual(by('ballari').climate);
  });

  it('uses the handoff sample distances', () => {
    expect([by('mysuru'), by('tumakuru'), by('hassan'), by('shivamogga'), by('belagavi'), by('kolar'), by('chennai'), by('coimbatore'), by('hyderabad')].map((x) => x.distance_km)).toEqual([150, 70, 185, 300, 500, 70, 350, 365, 570]);
  });

  it('has a position and a distance for every district, inside India', () => {
    expect(d.every((x) => x.lat !== null && x.lng !== null && x.distance_km !== null)).toBe(true);
    expect(by('bengaluru-urban').distance_km!).toBeLessThan(30);
  });

  it('enables pages for Karnataka only (30 districts + Vijayanagara)', () => {
    const enabled = d.filter((x) => x.page_enabled);
    expect(enabled).toHaveLength(31);
    expect(enabled.every((x) => x.state_code === 'KA')).toBe(true);
  });

  it('GST state codes are two digits and Karnataka is 29', () => {
    expect(file.records.states.find((s) => s.code === 'KA')!.gst_state_code).toBe('29');
    expect(file.records.states.every((s) => /^\d{2}$/.test(s.gst_state_code))).toBe(true);
  });

  it('records the sheet fix for the impossible Kanpur Dehat temperature', () => {
    expect(by('kanpur-dehat').climate.temp_max).toBeLessThan(50);
    expect(by('kanpur-dehat').review_notes.join(' ')).toMatch(/implausible/);
  });
});

describe('data/seed/district-hq.json', () => {
  it('validates and credits OpenStreetMap', () => {
    const t = hqTableSchema.parse(JSON.parse(read('data/seed/district-hq.json')));
    expect(Object.keys(t.records)).toHaveLength(645);
    expect(t.attribution).toMatch(/OpenStreetMap/);
  });
});

describe('data/seed/pincodes.csv', () => {
  const lines = read('data/seed/pincodes.csv').split('\n').filter(Boolean);
  it('has the header and unique six-digit pincodes with known states', () => {
    expect(lines[0]).toBe('pincode,office_name,district_slug,state_code');
    const pins = lines.slice(1).map((l) => l.split(',')[0]!);
    expect(pins.every((p) => /^[1-9]\d{5}$/.test(p))).toBe(true);
    expect(new Set(pins).size).toBe(pins.length);
    expect(pins.length).toBeGreaterThan(19000);
  });
  it('maps Bengaluru and Mysuru pincodes to their districts', () => {
    expect(lines).toContain('560001,Bengaluru,bengaluru-urban,KA');
    expect(lines.find((l) => l.startsWith('570001,'))).toMatch(/,mysuru,KA$/);
  });
});

describe('data/media/sourcing-log.json', () => {
  const log = JSON.parse(read('data/media/sourcing-log.json')) as { policy: string; plants: Record<string, { status: string; file?: string; sha256?: string; licence?: string; author?: string; source_url?: string; same_as?: string; searches: unknown[] }> };
  const entries = Object.entries(log.plants);

  it('covers all 71 plants without a photo in the backup', () => {
    expect(entries).toHaveLength(71);
    expect(entries.every(([, v]) => ['sourced', 'shared', 'missing'].includes(v.status))).toBe(true);
    expect(log.policy).toMatch(/No AI-generated/);
  });
  it('every sourced file exists, matches its hash, and carries an allowed licence, author and source', () => {
    const sourced = entries.filter(([, v]) => v.status === 'sourced');
    expect(sourced.length).toBeGreaterThan(55);
    for (const [key, v] of sourced) {
      const path = join(ROOT, 'data/media/masters', v.file!);
      expect(existsSync(path), key).toBe(true);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), key).toBe(v.sha256);
      expect(licenceAllowedForTest(v.licence!), `${key} ${v.licence}`).toBe(true);
      expect(v.author, key).toBeTruthy();
      expect(v.source_url, key).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(v.searches.length, key).toBeGreaterThan(0);
    }
  });
  it('shared rows point at a sourced plant; missing rows keep their search trail', () => {
    for (const [key, v] of entries) {
      if (v.status === 'shared') expect(log.plants[v.same_as!]?.status, key).toBe('sourced');
      if (v.status === 'missing') expect(v.searches.length, key).toBeGreaterThan(0);
    }
  });
});
