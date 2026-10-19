import type { Paise } from './common';
import type { SettingsActionResult } from './extensions';

export type PaymentState = 'pending' | 'completed' | 'failed' | 'expired';

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  /** Our payment attempt id; used as the provider's merchant order id (never reused). */
  attemptId: string;
  amountPaise: Paise;
  customer: { name: string | null; phone: string | null; email: string | null };
  returnUrl: string;
  expiresAt: Date;
}

export interface CreatePaymentResult {
  providerRef: string;
  /** Where to send the buyer; null for offline methods (bank transfer, pay at nursery). */
  redirectUrl: string | null;
  state: PaymentState;
  expiresAt: Date;
}

export interface PaymentStatus {
  providerRef: string;
  state: PaymentState;
  amountPaise: Paise;
  paidAt: Date | null;
  raw: unknown;
}

export interface PaymentWebhookInput {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
}

export interface PaymentWebhookResult {
  verified: boolean;
  /** Provider event id for the dedupe table. */
  eventId: string | null;
  providerRef: string | null;
  event: string | null;
  /** Hint only: the order is marked paid after `fetchStatus` confirms (never from webhook or redirect alone). */
  state: PaymentState | null;
}

export interface RefundInput {
  providerRef: string;
  refundId: string;
  amountPaise: Paise;
  reason: string | null;
}

export interface RefundResult {
  providerRefundRef: string;
  state: 'pending' | 'completed' | 'failed';
}

/** One adapter per provider (phonepe, mock, cod_partial, bank_transfer). Selected by settings, never by NODE_ENV. */
export interface PaymentProvider {
  id: string;
  kind: 'redirect' | 'offline' | 'partial_advance';
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  fetchStatus(providerRef: string): Promise<PaymentStatus>;
  handleWebhook?(input: PaymentWebhookInput): Promise<PaymentWebhookResult>;
  refund?(input: RefundInput): Promise<RefundResult>;
  testConnection?(): Promise<SettingsActionResult>;
}
