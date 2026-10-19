import { connection } from 'next/server';
import { sitemapFileResponse } from '../server';

/** GET /sitemap/<name>.xml */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  await connection();
  return sitemapFileResponse((await ctx.params).file);
}
