import type { CartBlockProps } from '@ecomkit/core/contracts';
import { fakeShippingQuote, TEST_NOW, type TestDb } from '@ecomkit/core/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cartMessages } from '../src/messages';
import { addLine, getCartView, replacePackage, setDeliveryMethod, type CartContext } from '../src/server';
import { CartPageView } from '../src/ui';
import { bind, cartDb, fakeDiscounts, makeVariant } from './helpers';

let t: TestDb;
const seen: CartBlockProps[] = [];
function TruckBlock(props: CartBlockProps) {
  seen.push(props);
  return <div data-block="truck">{props.lines.reduce((s, l) => s + l.weightKg * l.qty, 0)}</div>;
}

beforeAll(async () => {
  t = await cartDb('render');
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const page = (view: Awaited<ReturnType<typeof getCartView>>, notice: string | null = null) =>
  renderToStaticMarkup(<CartPageView view={view} messages={cartMessages} blockComponents={[TruckBlock]} inputsHref="/inputs" notice={notice} />);

describe('cart page', () => {
  it('renders the package zone above additional items, nudges, inputs suggestion, blocks, delivery, coupon and summary', async () => {
    const plant = await makeVariant(t, { name: 'Test sapling', listPaise: 49_000, tiers: [{ minQty: 100, unitPaise: 34_000 }], weightKg: 2 });
    const other = await makeVariant(t, { name: 'Other sapling', listPaise: 20_000, weightKg: 1 });
    bind({ services: { shipping: fakeShippingQuote() }, discounts: fakeDiscounts({}).port });
    const first = await addLine({ token: null, customerId: null, now: TEST_NOW }, { variantId: plant.variantId, qty: 13 });
    const ctx: CartContext = { token: first.issuedToken, customerId: null, now: TEST_NOW };
    await replacePackage(ctx, { packageId: 'plan-x', landSqft: 43_560, lines: [{ variantId: plant.variantId, qty: 50, origin: { source: 'planting', recommendedQty: 48 } }] });
    await addLine(ctx, { variantId: other.variantId, qty: 1 });
    await setDeliveryMethod(ctx, 'local');
    const html = page(await getCartView(ctx));

    expect(html.indexOf('data-zone="package"')).toBeLessThan(html.indexOf('data-zone="additional"'));
    expect(html).toContain('For 43,560 sq ft of land');
    expect(html).toContain('Bulk at 100 (37 more)');
    expect(html).toContain('Recommended 48');
    expect(html).toContain('Recommended inputs for your plants');
    expect(html).toContain('data-block="truck"');
    expect(seen.at(-1)).toMatchObject({ selectedMethodId: 'local' });
    expect(seen.at(-1)!.lines.map((l) => l.kind).sort()).toEqual(['package', 'product', 'product']);
    expect(html).toContain('Local delivery');
    expect(html).toContain('On Saturday 24 Oct');
    expect(html).toContain('Coupon code');
    expect(html).toContain('No cancellation or return');
    expect(html).toMatch(/Proceed to pay Rs [\d,]+/);
    expect(html).toContain('data-cta="cart-proceed-to-pay"');
    expect(html).not.toContain('\u2014'); // no em dash in copy
  });

  it('renders the empty state and a notice', () => {
    const html = page(null, cartMessages.notices.restore_expired!);
    expect(html).toContain('Your cart is empty');
    expect(html).toContain('That cart link has expired.');
    expect(html).toContain('href="/plants"');
  });
});
