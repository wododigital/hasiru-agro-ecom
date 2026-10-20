import { plantCalculatorData } from '../server/data';

/** GET /api/calculators/plants: plants with spacing and price books for the modal calculator (no personal data). */
export async function GET(): Promise<Response> {
  const data = await plantCalculatorData();
  return Response.json(data, { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' } });
}
