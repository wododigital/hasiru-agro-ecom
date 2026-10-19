import { TRACK_EVENTS, type TrackEventName } from '@ecomkit/core/contracts';
import { z } from 'zod';

/** Byte cap on one beacon body, checked before parsing. Keepalive requests share a 64 KiB pool per page. */
export const MAX_BEACON_BYTES = 16_384;
/** Events per batch; the collector never sends more. */
export const MAX_BATCH_EVENTS = 50;
const MAX_PROPS = 20;

const propValue = z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]);

/**
 * One collected event, short keys to keep the collector small:
 * i = client event id (uuid, the idempotency key), n = name, p = path with only campaign params kept,
 * t = client epoch ms, d = props.
 */
export const beaconEventSchema = z.object({
  i: z.uuid(),
  n: z.enum(TRACK_EVENTS),
  p: z.string().min(1).max(600).startsWith('/'),
  t: z.number().int().positive(),
  d: z
    .record(z.string().min(1).max(40), propValue)
    .refine((d) => Object.keys(d).length <= MAX_PROPS, { message: `at most ${MAX_PROPS} props` })
    .optional(),
});
export type BeaconEvent = z.infer<typeof beaconEventSchema>;

/** e = events (each validated on its own so one bad event never drops the batch), r = referrer host of the page load. */
export const beaconBatchSchema = z.object({
  e: z.array(z.unknown()).min(1).max(MAX_BATCH_EVENTS),
  r: z.string().max(253).optional(),
});

export interface ParsedBatch {
  events: BeaconEvent[];
  rejected: number;
  referrerHost: string | null;
}

/** Validates the envelope, keeps the valid events (unknown names and malformed events are dropped and counted). */
export function parseBatch(body: unknown): ParsedBatch | null {
  const envelope = beaconBatchSchema.safeParse(body);
  if (!envelope.success) return null;
  const events: BeaconEvent[] = [];
  let rejected = 0;
  for (const raw of envelope.data.e) {
    const ev = beaconEventSchema.safeParse(raw);
    if (ev.success) events.push(ev.data);
    else rejected++;
  }
  const host = envelope.data.r?.toLowerCase().replace(/[^a-z0-9.:-]/g, '') || null;
  return { events, rejected, referrerHost: host };
}

export function isTrackEventName(name: string): name is TrackEventName {
  return (TRACK_EVENTS as readonly string[]).includes(name);
}
