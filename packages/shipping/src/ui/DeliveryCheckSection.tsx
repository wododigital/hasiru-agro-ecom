import type { PdpSectionProps } from '@ecomkit/core/contracts';
import { shippingMessages, type ShippingMessages } from '../messages';
import { DeliveryCheckIsland } from './DeliveryCheckIsland';

/** PDP section (slot `aside`): pincode delivery check with dates for every method. Static shell, the island fetches. */
export function DeliveryCheckSection({ messages = shippingMessages }: PdpSectionProps & { messages?: ShippingMessages }) {
  return <DeliveryCheckIsland messages={{ check: messages.check, methods: messages.methods, reasons: messages.reasons }} />;
}
