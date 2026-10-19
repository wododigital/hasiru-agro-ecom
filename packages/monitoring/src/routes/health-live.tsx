// GET /api/health/live: the process answers. No dependencies, no secrets.
import { dynamicRequest } from '../server/request';

export async function GET(): Promise<Response> {
  await dynamicRequest();
  return Response.json({ status: 'ok', release: process.env.GIT_SHA ?? null, uptimeSec: Math.round(process.uptime()) }, { headers: { 'cache-control': 'no-store' } });
}
