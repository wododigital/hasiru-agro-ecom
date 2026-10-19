// POST /api/media/upload
import { handleUpload } from '../server/http';

export function POST(req: Request): Promise<Response> {
  return handleUpload(req);
}
