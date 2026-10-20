// Mock GA4 Measurement Protocol for dev and test: /api/_mock/ga4/mp/collect and /api/_mock/ga4/debug/mp/collect.
// 404 unless ENABLE_MOCKS=1. Validates like the debug endpoint and keeps what it received in this process.
import { ga4BodySchema, type Ga4Body } from '../domain/conversions';

interface Ga4MockState {
  received: { measurementId: string; body: Ga4Body; at: string }[];
}
const g = globalThis as unknown as { __ecomkitGa4Mock?: Ga4MockState };
export const ga4MockState = (): Ga4MockState => (g.__ecomkitGa4Mock ??= { received: [] });
export const resetGa4Mock = (): void => void delete g.__ecomkitGa4Mock;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function POST(req: Request): Promise<Response> {
  if (process.env.ENABLE_MOCKS !== '1') return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const debug = url.pathname.endsWith('/debug/mp/collect');
  if (!debug && !url.pathname.endsWith('/mp/collect')) return new Response(null, { status: 404 });
  const measurementId = url.searchParams.get('measurement_id') ?? '';
  const messages: { fieldPath: string; description: string; validationCode: string }[] = [];
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) messages.push({ fieldPath: 'measurement_id', description: 'measurement_id is missing or invalid', validationCode: 'VALUE_INVALID' });
  if (!url.searchParams.get('api_secret')) messages.push({ fieldPath: 'api_secret', description: 'api_secret is required', validationCode: 'VALUE_REQUIRED' });
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    messages.push({ fieldPath: '', description: 'body is not JSON', validationCode: 'VALUE_INVALID' });
  }
  const parsed = ga4BodySchema.safeParse(raw);
  if (!parsed.success) for (const i of parsed.error.issues) messages.push({ fieldPath: i.path.join('.'), description: i.message, validationCode: 'VALUE_INVALID' });
  if (messages.length) return json(400, { validationMessages: messages });
  ga4MockState().received.push({ measurementId, body: parsed.data!, at: new Date().toISOString() });
  return debug ? json(200, { validationMessages: [] }) : new Response(null, { status: 204 });
}
