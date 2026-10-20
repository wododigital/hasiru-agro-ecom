'use server';

import { requirePermission } from '@ecomkit/core/auth-context';
import { paise } from '@ecomkit/core/money';
import { zodAction } from '@ecomkit/core/validation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { markBankTransferReceived, startRefundTask } from '../server/payments';

const back = (msg: string): never => redirect(`/admin/payments?msg=${encodeURIComponent(msg)}`);

const startTask = zodAction(
  z.object({ refundId: z.uuid() }),
  async ({ refundId }) => {
    const staff = await requirePermission('orders.refund');
    return startRefundTask({ refundId, actorId: staff.userId });
  },
  { permission: 'orders.refund' },
);

/** "Refund now" on a refund task (late or mismatched capture). */
export async function startRefundTaskAction(form: FormData): Promise<void> {
  const res = await startTask(form);
  if (!res.ok) back(res.formError ?? 'invalid');
  else back(res.data.ok ? 'refund_started' : res.data.reason);
}

const received = zodAction(
  z.object({ attemptId: z.uuid(), amountRupees: z.coerce.number().positive().max(10_000_000) }),
  async ({ attemptId, amountRupees }) => {
    const staff = await requirePermission('orders.write');
    return markBankTransferReceived({ attemptId, amountPaise: paise(amountRupees), actorId: staff.userId });
  },
  { permission: 'orders.write' },
);

/** "Mark received" on an open bank transfer. A different amount raises the mismatch alert and a refund task. */
export async function markReceivedAction(form: FormData): Promise<void> {
  const res = await received(form);
  if (!res.ok) back(res.formError ?? 'invalid');
  else if (!res.data.ok) back(res.data.reason);
  else back(res.data.anomaly ?? 'received');
}
