import { postConsent } from '../server/consent';

export function POST(req: Request): Promise<Response> {
  return postConsent(req);
}
