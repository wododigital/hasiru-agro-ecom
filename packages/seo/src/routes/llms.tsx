import { connection } from 'next/server';
import { llmsResponse } from '../server';

/** GET /llms.txt */
export async function GET(): Promise<Response> {
  await connection();
  return llmsResponse();
}
