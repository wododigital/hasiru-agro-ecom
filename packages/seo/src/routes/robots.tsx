import { connection } from 'next/server';
import { robotsResponse } from '../server';

/** GET /robots.txt (a route, never a static file in public/). */
export async function GET(): Promise<Response> {
  await connection();
  return robotsResponse();
}
