import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import { readAttachment } from '../server';

/** GET /api/admin/enquiries/attachments/[id]: private file download for staff with enquiries.read. Never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const file = await readAttachment((await params).id);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        'content-type': file.type,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    // Same answer for forbidden and missing: an id's existence is never revealed.
    if (err instanceof ForbiddenError || err instanceof NotFoundError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
