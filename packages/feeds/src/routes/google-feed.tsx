import { serveFeed } from '../server/serve';

export function GET(req: Request): Promise<Response> {
  return serveFeed('google', req);
}
