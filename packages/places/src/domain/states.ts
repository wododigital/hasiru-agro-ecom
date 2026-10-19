// Every Indian state and union territory. The first 24 are the ones in the client's district sheet. Codes follow ISO 3166-2:IN suffixes.
export interface StateInfo {
  code: string;
  name: string;
  /** Two-digit GST state code (decides CGST+SGST vs IGST). */
  gstStateCode: string;
}

export const STATES: readonly StateInfo[] = [
  { code: 'AP', name: 'Andhra Pradesh', gstStateCode: '37' },
  { code: 'AR', name: 'Arunachal Pradesh', gstStateCode: '12' },
  { code: 'AS', name: 'Assam', gstStateCode: '18' },
  { code: 'BR', name: 'Bihar', gstStateCode: '10' },
  { code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' },
  { code: 'GA', name: 'Goa', gstStateCode: '30' },
  { code: 'GJ', name: 'Gujarat', gstStateCode: '24' },
  { code: 'HR', name: 'Haryana', gstStateCode: '06' },
  { code: 'HP', name: 'Himachal Pradesh', gstStateCode: '02' },
  { code: 'JH', name: 'Jharkhand', gstStateCode: '20' },
  { code: 'KA', name: 'Karnataka', gstStateCode: '29' },
  { code: 'KL', name: 'Kerala', gstStateCode: '32' },
  { code: 'MP', name: 'Madhya Pradesh', gstStateCode: '23' },
  { code: 'MH', name: 'Maharashtra', gstStateCode: '27' },
  { code: 'MN', name: 'Manipur', gstStateCode: '14' },
  { code: 'ML', name: 'Meghalaya', gstStateCode: '17' },
  { code: 'MZ', name: 'Mizoram', gstStateCode: '15' },
  { code: 'OD', name: 'Odisha', gstStateCode: '21' },
  { code: 'PB', name: 'Punjab', gstStateCode: '03' },
  { code: 'RJ', name: 'Rajasthan', gstStateCode: '08' },
  { code: 'TN', name: 'Tamil Nadu', gstStateCode: '33' },
  { code: 'TG', name: 'Telangana', gstStateCode: '36' },
  { code: 'UP', name: 'Uttar Pradesh', gstStateCode: '09' },
  { code: 'WB', name: 'West Bengal', gstStateCode: '19' },
  // States and territories with no rows in the district sheet. They exist so pincodes and GST resolve everywhere.
  { code: 'AN', name: 'Andaman and Nicobar Islands', gstStateCode: '35' },
  { code: 'CH', name: 'Chandigarh', gstStateCode: '04' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', gstStateCode: '26' },
  { code: 'DL', name: 'Delhi', gstStateCode: '07' },
  { code: 'JK', name: 'Jammu and Kashmir', gstStateCode: '01' },
  { code: 'LA', name: 'Ladakh', gstStateCode: '38' },
  { code: 'LD', name: 'Lakshadweep', gstStateCode: '31' },
  { code: 'NL', name: 'Nagaland', gstStateCode: '13' },
  { code: 'PY', name: 'Puducherry', gstStateCode: '34' },
  { code: 'SK', name: 'Sikkim', gstStateCode: '11' },
  { code: 'TR', name: 'Tripura', gstStateCode: '16' },
  { code: 'UK', name: 'Uttarakhand', gstStateCode: '05' },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const BY_KEY = new Map(STATES.map((s) => [squash(s.name), s]));
// Spellings the sheet and India Post use for the same state.
for (const [alias, code] of [
  ['tamilnadu', 'TN'],
  ['orissa', 'OD'],
  ['thedadraandnagarhavelianddamananddiu', 'DH'],
  ['dadraandnagarhaveli', 'DH'],
  ['damananddiu', 'DH'],
  ['jammuandkashmir', 'JK'],
] as const) BY_KEY.set(alias, STATES.find((s) => s.code === code)!);

/** Resolves the sheet's spelling ("TAMILNADU", "ODISHA") or a plain name to a state. */
export function stateFromSheet(raw: string): StateInfo | null {
  return BY_KEY.get(squash(raw)) ?? null;
}

export function stateByCode(code: string): StateInfo | null {
  return STATES.find((s) => s.code === code.toUpperCase()) ?? null;
}
