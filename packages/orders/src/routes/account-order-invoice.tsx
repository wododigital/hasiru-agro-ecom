import { NotFoundError } from '@ecomkit/core/auth-context';
import { getMyOrder, invoiceResponse } from '../server';

/** GET /account/orders/[id]/invoice.pdf: the owner's invoice. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const detail = await getMyOrder(id);
    return invoiceResponse(detail.order.id);
  } catch (err) {
    if (err instanceof NotFoundError) return invoiceResponse(null);
    throw err;
  }
}
