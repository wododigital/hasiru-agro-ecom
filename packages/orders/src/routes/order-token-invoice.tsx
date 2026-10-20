import { getOrderByToken, invoiceResponse } from '../server';

/** GET /order/[token]/invoice.pdf */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const detail = await getOrderByToken(token);
  return invoiceResponse(detail?.order.id ?? null);
}
