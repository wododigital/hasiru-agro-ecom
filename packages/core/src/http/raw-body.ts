export class PayloadTooLargeError extends Error {
  readonly status = 413;
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/** The exact bytes of a request body (webhook signatures are computed over these), capped at `maxBytes`. */
export async function readRawBody(req: Request, maxBytes = 1_048_576): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError(maxBytes);
  if (!req.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
