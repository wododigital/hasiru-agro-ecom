// GET /media/[...path]
import { handleMediaGet } from '../server/http';

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return handleMediaGet(req, (await ctx.params).path);
}
