import { connection } from 'next/server';
import { ogResponse } from '../server';

/** GET /og/<path...> social card. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }): Promise<Response> {
  await connection();
  return ogResponse((await ctx.params).slug);
}
