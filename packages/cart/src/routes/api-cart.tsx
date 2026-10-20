import { cartContextFromRequest, getCartView, toDrawerData } from '../server';

/** GET /api/cart: the drawer's summary of the visitor's cart (formatted, no ids beyond line ids). */
export async function GET(req: Request): Promise<Response> {
  const data = toDrawerData(await getCartView(await cartContextFromRequest(req)));
  return Response.json(data, { headers: { 'cache-control': 'no-store' } });
}
