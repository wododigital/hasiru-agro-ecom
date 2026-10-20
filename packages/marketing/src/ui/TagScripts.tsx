import { Suspense } from 'react';
import { marketingMessages, type MarketingMessages } from '../messages';
import { publicTagConfig, purchaseTagData } from '../server';
import { ConsentBannerIsland } from './ConsentBannerIsland';
import { PurchaseTagsIsland } from './PurchaseTagsIsland';
import { TagLoaderIsland } from './TagLoaderIsland';

/**
 * Put once in the storefront layout: the consent banner (when enabled) and the tag loader. The config is cached
 * (`settings:marketing`), so the shell stays static; vendor scripts load in the browser after consent and idle.
 */
export async function TagScripts({ messages = marketingMessages }: { messages?: MarketingMessages }) {
  const config = await publicTagConfig();
  return (
    <>
      <Suspense fallback={null}>
        <TagLoaderIsland config={config} />
      </Suspense>
      {config.banner && <ConsentBannerIsland messages={messages.consent} />}
    </>
  );
}

/** Same banner on its own, for a host that renders the tag loader elsewhere. */
export function ConsentBanner({ messages = marketingMessages }: { messages?: MarketingMessages }) {
  return <ConsentBannerIsland messages={messages.consent} />;
}

/** On the order confirmation page (owner-only, request-time): browser purchase tags for a non-test order. */
export async function PurchaseTags({ orderId }: { orderId: string }) {
  const data = await purchaseTagData(orderId);
  return data ? <PurchaseTagsIsland data={data} /> : null;
}
