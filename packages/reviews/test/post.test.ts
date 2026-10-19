import { describe, expect, it } from 'vitest';
import { handleReviewPost } from '../src/server/post';
import { asCustomer, asGuest } from './viewers';

const post = (headers: Record<string, string>, body?: BodyInit) =>
  handleReviewPost(new Request('http://shop.test/api/reviews', { method: 'POST', headers: { accept: 'application/json', ...headers }, body, duplex: 'half' } as RequestInit));

/** A body that never declares its length, so only the byte cap can stop it. */
const endless = () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ > 40) c.close();
      else c.enqueue(chunk);
    },
  });
};

describe('POST /api/reviews guards', () => {
  it('rejects cross-site requests before anything else', async () => {
    asCustomer();
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ origin: 'https://evil.test', host: 'shop.test' })).status).toBe(403);
  });

  it('sends guests to login without reading the body', async () => {
    asGuest();
    expect((await post({ 'sec-fetch-site': 'same-origin' }, endless())).status).toBe(404);
  });

  it('caps the bytes actually read, whatever Content-Length says', async () => {
    asCustomer();
    const res = await post({ 'sec-fetch-site': 'same-origin', 'content-type': 'multipart/form-data; boundary=x' }, endless());
    expect(res.status).toBe(413);
  });
});
