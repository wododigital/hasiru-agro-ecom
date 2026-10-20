import { serveFeed } from '../server/serve';

export function GET(req: Request): Promise<Response> {
  return serveFeed('meta', req);
}
