/**
 * Fixed-size bitsets over the product list (bit i = product at position i). AND/OR are word ops,
 * counts are popcounts: sub-millisecond for a few hundred products, no library.
 */
export type Bits = Uint32Array;

export const wordCount = (n: number): number => (n + 31) >>> 5;

export function emptyBits(n: number): Bits {
  return new Uint32Array(wordCount(n));
}

export function fullBits(n: number): Bits {
  const b = new Uint32Array(wordCount(n)).fill(0xffffffff);
  const tail = n & 31;
  if (tail && b.length) b[b.length - 1] = (1 << tail) - 1;
  return b;
}

export function bitsFrom(n: number, positions: Iterable<number>): Bits {
  const b = emptyBits(n);
  for (const i of positions) if (i >= 0 && i < n) b[i >>> 5]! |= 1 << (i & 31);
  return b;
}

export function hasBit(b: Bits, i: number): boolean {
  return ((b[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0;
}

export function and(a: Bits, b: Bits): Bits {
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! & (b[i] ?? 0);
  return out;
}

export function or(a: Bits, b: Bits): Bits {
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! | (b[i] ?? 0);
  return out;
}

function popWord(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function popcount(b: Bits): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) c += popWord(b[i]!);
  return c;
}

/** popcount(a & b) without allocating. */
export function andCount(a: Bits, b: Bits): number {
  let c = 0;
  for (let i = 0; i < a.length; i++) c += popWord(a[i]! & (b[i] ?? 0));
  return c;
}

export function positions(b: Bits): number[] {
  const out: number[] = [];
  for (let w = 0; w < b.length; w++) {
    let x = b[w]!;
    while (x) {
      const low = x & -x;
      out.push((w << 5) + 31 - Math.clz32(low));
      x ^= low;
    }
  }
  return out;
}

/** Little-endian bytes, base64: `ceil(n / 8)` bytes, so 350 products cost 60 characters per value. */
export function encodeBits(b: Bits, n: number): string {
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = (b[i >>> 2]! >>> ((i & 3) * 8)) & 0xff;
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function decodeBits(s: string, n: number): Bits {
  const bin = atob(s);
  const b = emptyBits(n);
  for (let i = 0; i < bin.length && i < Math.ceil(n / 8); i++) b[i >>> 2]! |= bin.charCodeAt(i) << ((i & 3) * 8);
  const tail = n & 31;
  if (tail && b.length) b[b.length - 1]! &= (1 << tail) - 1;
  return b;
}
