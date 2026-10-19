import { connection } from 'next/server';
import { sitemapIndexResponse } from '../server';

/** GET /sitemap.xml */
export async function GET(): Promise<Response> {
  await connection();
  return sitemapIndexResponse();
}
