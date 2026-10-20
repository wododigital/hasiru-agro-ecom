import { getInvoice, type InvoiceDocument } from './invoice';
import { invoicePdf } from './invoice-pdf';

/** PDF response for an order's invoice, or 404 when none was issued. Never cached by shared caches. */
export async function invoiceResponse(orderId: string | null): Promise<Response> {
  const invoice = orderId ? await getInvoice(orderId) : null;
  if (!invoice) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const pdf = await invoicePdf(invoice.document as InvoiceDocument);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${invoice.number}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
