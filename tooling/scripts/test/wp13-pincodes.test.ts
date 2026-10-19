import { describe, expect, it } from 'vitest';
import { buildPincodes } from '../seed/pincodes';

const districts = [
  { slug: 'bengaluru-urban', name: 'Bengaluru Urban', state_code: 'KA', aliases: ['Bangalore Urban', 'Bangalore', 'Bengaluru'] },
  { slug: 'kodagu', name: 'Kodagu', state_code: 'KA', aliases: ['Kodugu', 'Coorg'] },
  { slug: 'mysuru', name: 'Mysuru', state_code: 'KA', aliases: ['Mysore'] },
];

const HEAD = 'circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude';
const row = (office: string, pin: string, type: string, delivery: string, district: string, state: string) =>
  `"Karnataka Circle","R","D","${office}",${pin},${type},${delivery},"${district}",${state},NA,NA`;

describe('buildPincodes', () => {
  const csv = [
    HEAD,
    row('Bangalore G.P.O.', '560001', 'HO', 'Delivery', 'BANGALORE', 'KARNATAKA'),
    row('Cubbon Park S.O', '560001', 'PO', 'Delivery', 'BANGALORE', 'KARNATAKA'),
    row('Tiny B.O', '571201', 'BO', 'Non Delivery', 'KODAGU', 'KARNATAKA'),
    row('Somewhere B.O', '571202', 'BO', 'Delivery', 'NOWHERE', 'KARNATAKA'),
    row('Odd B.O', '12345', 'BO', 'Delivery', 'MYSORE', 'KARNATAKA'),
    row('Lost B.O', '682001', 'BO', 'Delivery', 'NA', 'NA'),
  ].join('\n');

  it('gives one row per pincode, the head office as name, and leaves unmatched districts blank', () => {
    const out = buildPincodes(csv, districts);
    expect(out.csv.split('\n')).toEqual([
      'pincode,office_name,district_slug,state_code',
      '560001,Bangalore,bengaluru-urban,KA',
      '571201,Tiny,kodagu,KA',
      '571202,Somewhere,,KA',
      '682001,Lost,,KA', // state recovered from the circle name
      '',
    ]);
    expect(out.rows).toBe(4);
    expect(out.matched).toBe(2);
    expect(out.unmatchedByState).toEqual({ KA: 2 });
  });

  it('is deterministic', () => {
    expect(buildPincodes(csv, districts).csv).toBe(buildPincodes(csv, districts).csv);
  });
});
