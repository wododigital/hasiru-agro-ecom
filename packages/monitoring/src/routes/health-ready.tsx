// GET /api/health/ready: readiness for the external uptime checker and the load balancer.
// 200 unless a readiness check is down (503). Check ids and statuses only: details live behind admin auth.
import { dynamicRequest } from '../server/request';
import { readiness } from '../server/checks';

export async function GET(): Promise<Response> {
  await dynamicRequest();
  const result = await readiness();
  return Response.json(result, { status: result.status === 'down' ? 503 : 200, headers: { 'cache-control': 'no-store' } });
}
