import { Button, Checkbox, Input } from '@ecomkit/ui';
import type { CatalogMessages } from '../messages';

/** Back-in-stock request (inventory module's /api/notify-me). A plain form: works without JS. */
export function NotifyForm({ variantId, messages }: { variantId: string; messages: CatalogMessages }) {
  const m = messages.pdp;
  return (
    <form id="notify" method="post" action="/api/notify-me" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
      <h2 className="font-display text-lg">{m.notifyTitle}</h2>
      <input type="hidden" name="variantId" value={variantId} />
      <label className="flex flex-col gap-1 text-sm">
        {m.notifyPhone}
        <Input type="tel" name="phone" inputMode="tel" autoComplete="tel" required />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {m.notifyEmail}
        <Input type="email" name="email" autoComplete="email" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="consent" value="1" required />
        {m.notifyConsent}
      </label>
      <Button type="submit" data-cta="pdp-notify-me">
        {m.notifySubmit}
      </Button>
    </form>
  );
}
