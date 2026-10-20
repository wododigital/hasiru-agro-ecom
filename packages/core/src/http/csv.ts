/** A text cell starting with one of these is a formula to Excel, Sheets and LibreOffice (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 field. Text that a spreadsheet would run as a formula is prefixed with `'`; numbers are written as
 * they are, so money and counts stay numeric. Null and undefined are empty.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const csvLine = (cells: readonly unknown[]): string => `${cells.map(csvCell).join(',')}\r\n`;

/**
 * Streams a CSV download: UTF-8 BOM (so Excel reads Kannada and the rupee sign), the header, then one line per row
 * pulled from `rows` only as fast as the client reads. Not cached, never sniffed as HTML.
 */
export function csvResponse(filename: string, header: readonly string[], rows: AsyncIterable<readonly unknown[]>): Response {
  const encoder = new TextEncoder();
  const it = rows[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${csvLine(header)}`));
    },
    async pull(controller) {
      const next = await it.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(csvLine(next.value)));
    },
    async cancel() {
      await it.return?.();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
