import { gmailCallback } from '../server/gmail-oauth';

/** GET /api/auth/gmail/callback: Google sends the admin back here after Connect Gmail. */
export function GET(req: Request): Promise<Response> {
  return gmailCallback(req);
}
