// Gateway wire shapes (Standard Checkout, OAuth). Parsed leniently: the docs ask integrators to avoid strict parsing.
import { z } from 'zod';

/** Token and API hosts per mode. The live token host path (identity-manager) differs from the live API path. */
export const PHONEPE_HOSTS = {
  sandbox: { token: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token', api: 'https://api-preprod.phonepe.com/apis/pg-sandbox' },
  live: { token: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token', api: 'https://api.phonepe.com/apis/pg' },
} as const;
export const PHONEPE_ALLOW_HOSTS = ['api.phonepe.com', 'api-preprod.phonepe.com'] as const;

export const PHONEPE_PATHS = {
  pay: '/checkout/v2/pay',
  status: (merchantOrderId: string) => `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false&errorContext=true`,
  refund: '/payments/v2/refund',
  refundStatus: (merchantRefundId: string) => `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`,
} as const;

const epoch = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]);

export const tokenResponse = z.looseObject({
  access_token: z.string().min(1),
  /** Epoch seconds. */
  expires_at: epoch,
  token_type: z.string().optional(),
});

export const payResponse = z
  .looseObject({
    orderId: z.string(),
    state: z.string(),
    redirectUrl: z.string().url(),
    expireAt: epoch.optional(),
    expiryAt: epoch.optional(),
  })
  .transform((r) => ({ ...r, expireAt: r.expireAt ?? r.expiryAt ?? null }));

export const statusResponse = z.looseObject({
  orderId: z.string().optional(),
  state: z.string(),
  amount: z.number().int().optional(),
  paymentDetails: z
    .array(z.looseObject({ transactionId: z.string().optional(), paymentMode: z.string().optional(), state: z.string().optional(), timestamp: epoch.optional() }))
    .optional(),
});

export const refundResponse = z.looseObject({ refundId: z.string(), amount: z.number().int().optional(), state: z.string() });
export const refundStatusResponse = z.looseObject({ refundId: z.string().optional(), amount: z.number().int().optional(), state: z.string(), errorCode: z.string().optional() });

export const errorResponse = z.looseObject({ code: z.string().optional(), message: z.string().optional() });

/** Webhook body: read `event` (not the deprecated `type`) and the root-level `payload.state`. */
export const webhookBody = z.looseObject({
  event: z.string().optional(),
  type: z.string().optional(),
  payload: z.looseObject({
    merchantOrderId: z.string().optional(),
    originalMerchantOrderId: z.string().optional(),
    merchantRefundId: z.string().optional(),
    state: z.string().optional(),
    amount: z.number().optional(),
  }),
});
export type WebhookBody = z.infer<typeof webhookBody>;

export const WEBHOOK_EVENTS = {
  orderCompleted: 'checkout.order.completed',
  orderFailed: 'checkout.order.failed',
  refundAccepted: 'pg.refund.accepted',
  refundCompleted: 'pg.refund.completed',
  refundFailed: 'pg.refund.failed',
} as const;

/** Body for the pay call. `expireAfter` is clamped to the gateway's 300 to 3600 s. */
export function payRequest(input: { merchantOrderId: string; amountPaise: number; expireAfterSec: number; redirectUrl: string; orderRef: string; message: string }) {
  return {
    merchantOrderId: input.merchantOrderId,
    amount: input.amountPaise,
    expireAfter: Math.min(3600, Math.max(300, Math.round(input.expireAfterSec))),
    metaInfo: { udf1: input.orderRef.slice(0, 256) },
    paymentFlow: { type: 'PG_CHECKOUT', message: input.message.slice(0, 120), merchantUrls: { redirectUrl: input.redirectUrl } },
  };
}
