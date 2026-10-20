// Mock Meta Conversions API for dev and test: POST /api/_mock/meta-capi/<version>/<pixelId>/events.
// 404 unless ENABLE_MOCKS=1. Validates hashing (64 hex), required fields and the event_time window, echoes
// events_received, and groups what it received by event_id (how Meta dedupes pixel + server events).
import { capiBodySchema, capiTimeIssue, type CapiEvent } from '../domain/conversions';

interface CapiMockState {
  received: { pixelId: string; event: CapiEvent; testEventCode: string | null; at: string }[];
}
const g = globalThis as unknown as { __ecomkitCapiMock?: CapiMockState };
export const capiMockState = (): CapiMockState => (g.__ecomkitCapiMock ??= { received: [] });
export const resetCapiMock = (): void => void delete g.__ecomkitCapiMock;

/** Received events grouped by `event_name:event_id`: one group per deduplicated conversion. */
export function capiDedupGroups(): Map<string, number> {
  const groups = new Map<string, number>();
  for (const r of capiMockState().received) {
    const key = `${r.event.event_name}:${r.event.event_id ?? r.at}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return groups;
}

const error = (message: string, code = 100) =>
  new Response(JSON.stringify({ error: { message, type: 'OAuthException', code, fbtrace_id: 'mock' } }), { status: 400, headers: { 'content-type': 'application/json' } });

export async function POST(req: Request): Promise<Response> {
  if (process.env.ENABLE_MOCKS !== '1') return new Response(null, { status: 404 });
  const m = /\/api\/_mock\/meta-capi\/v\d+\.\d+\/(\d+)\/events$/.exec(new URL(req.url).pathname);
  if (!m) return new Response(null, { status: 404 });
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return error('Invalid JSON body');
  }
  if (typeof raw.access_token !== 'string' || !raw.access_token) return error('An access token is required to request this resource.', 104);
  const parsed = capiBodySchema.safeParse(raw);
  if (!parsed.success) return error(`Invalid parameter: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const nowSec = Math.floor(Date.now() / 1000);
  for (const e of parsed.data.data) {
    const issue = capiTimeIssue(e.event_time, nowSec);
    if (issue) return error(`Invalid parameter: ${issue}`);
  }
  const at = new Date().toISOString();
  for (const event of parsed.data.data) capiMockState().received.push({ pixelId: m[1]!, event, testEventCode: parsed.data.test_event_code ?? null, at });
  return new Response(JSON.stringify({ events_received: parsed.data.data.length, messages: [], fbtrace_id: 'mock' }), { status: 200, headers: { 'content-type': 'application/json' } });
}
