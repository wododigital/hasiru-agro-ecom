import { randomFillSync } from 'node:crypto';

let lastMs = 0;
let seq = 0;

/** UUIDv7 (RFC 9562): 48-bit unix ms, then a 12-bit counter so ids made in the same millisecond still sort in order. */
export function newId(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  let ms = Date.now();
  if (ms <= lastMs) {
    seq = (seq + 1) & 0xfff;
    if (seq === 0) lastMs += 1; // counter wrapped: borrow the next millisecond
    ms = lastMs;
  } else {
    lastMs = ms;
    seq = bytes[6]! & 0x07; // random start, leaves room to count up
  }
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (seq >> 8);
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
