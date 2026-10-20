import type { Paise } from '@ecomkit/core/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { paymentsMessages as m } from '../src/messages';
import { PayReturn } from '../src/ui/PayReturn';

const html = (view: Parameters<typeof PayReturn>[0]['view']) => renderToStaticMarkup(<PayReturn view={view} selfHref="/pay/return?a=x" />);
const base = { amountPaise: 125000 as Paise, orderLink: '/order/guest-1', retryLink: null };

describe('PayReturn', () => {
  it('paid shows the amount and the order link', () => {
    const out = html({ ...base, state: 'paid' });
    expect(out).toContain(m.return.paid.title);
    expect(out).toContain('Rs 1,250');
    expect(out).toContain('href="/order/guest-1"');
  });
  it('pending refreshes itself without JS', () => {
    const out = html({ ...base, state: 'pending' });
    expect(out).toContain('http-equiv="refresh"');
    expect(out).toContain(m.return.pending.title);
  });
  it('failed offers a retry only while the window is open', () => {
    expect(html({ ...base, state: 'failed', retryLink: '/checkout/1/pay' })).toContain('href="/checkout/1/pay"');
    const closed = html({ ...base, state: 'failed' });
    expect(closed).toContain(m.return.failed.expired);
    expect(closed).not.toContain(m.return.retry);
  });
  it('review and not found', () => {
    expect(html({ ...base, state: 'review' })).toContain(m.return.review.title);
    expect(html(null)).toContain(m.return.notFound.title);
  });
});
