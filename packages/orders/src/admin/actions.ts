'use server';

import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import { paise } from '@ecomkit/core/money';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { parseManualLines } from '../domain';
import {
  addStaffNote,
  createManualOrder,
  OrderError,
  recordOfflinePayment,
  requestRefund,
  staffCreateReplacement,
  staffSetTestFlag,
  staffTransition,
} from '../server';

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const rupees = (form: FormData, key: string) => {
  const v = Number(str(form, key));
  return Number.isFinite(v) && v > 0 ? paise(v) : 0;
};

function errorCode(err: unknown): string | null {
  if (err instanceof ZodError || err instanceof RangeError) return 'invalid';
  if (err instanceof ForbiddenError) return 'forbidden';
  if (err instanceof NotFoundError) return 'not_found';
  if (err instanceof OrderError) return err.code;
  return null;
}

/** Plain <form action> posts (work without JS): the outcome comes back as `?done=` or `?error=` on the target page. */
async function run(path: string, write: () => Promise<string | void>): Promise<never> {
  let target = `${path}?done=1`;
  try {
    const next = await write();
    if (next) target = next;
  } catch (err) {
    const code = errorCode(err);
    if (!code) throw err;
    target = `${path}?error=${encodeURIComponent(code)}`;
  }
  revalidatePath('/admin/orders');
  redirect(target);
}

export async function transitionAction(form: FormData): Promise<never> {
  const orderId = str(form, 'orderId');
  return run(`/admin/orders/${orderId}`, async () => {
    await staffTransition({ orderId, to: str(form, 'to') as never, note: str(form, 'note') || undefined });
  });
}

export async function refundAction(form: FormData): Promise<never> {
  const orderId = str(form, 'orderId');
  return run(`/admin/orders/${orderId}`, async () => {
    await requestRefund({ orderId, amountPaise: rupees(form, 'amount'), reason: str(form, 'reason') });
  });
}

export async function offlinePaymentAction(form: FormData): Promise<never> {
  const orderId = str(form, 'orderId');
  return run(`/admin/orders/${orderId}`, async () => {
    await recordOfflinePayment({ orderId, amountPaise: rupees(form, 'amount') });
  });
}

export async function replacementAction(form: FormData): Promise<never> {
  const parentOrderId = str(form, 'orderId');
  return run(`/admin/orders/${parentOrderId}`, async () => {
    const lines = [...form.entries()]
      .filter(([k, v]) => k.startsWith('qty:') && Number(v) > 0)
      .map(([k, v]) => ({ lineId: k.slice(4), qty: Number(v) }));
    const child = await staffCreateReplacement({ parentOrderId, lines, reason: str(form, 'reason') });
    return `/admin/orders/${child.id}?done=replacement`;
  });
}

export async function noteAction(form: FormData): Promise<never> {
  const orderId = str(form, 'orderId');
  return run(`/admin/orders/${orderId}`, () => addStaffNote({ orderId, note: str(form, 'note') }));
}

export async function testFlagAction(form: FormData): Promise<never> {
  const orderId = str(form, 'orderId');
  return run(`/admin/orders/${orderId}`, () => staffSetTestFlag(orderId, str(form, 'isTest') === '1'));
}

export async function manualOrderAction(form: FormData): Promise<never> {
  return run('/admin/orders/new', async () => {
    const created = await createManualOrder({
      contact: { name: str(form, 'name'), phone: str(form, 'phone') || null, email: str(form, 'email') || null },
      address: str(form, 'line1')
        ? {
            name: str(form, 'name'),
            phone: str(form, 'phone'),
            line1: str(form, 'line1'),
            villageTown: str(form, 'villageTown') || null,
            pincode: str(form, 'pincode'),
            district: str(form, 'district') || null,
            state: str(form, 'state') || null,
            stateCode: str(form, 'stateCode').toUpperCase() || null,
          }
        : null,
      delivery: { kind: str(form, 'deliveryKind') as never, label: str(form, 'deliveryLabel') || null, slotDate: str(form, 'slotDate') || null },
      lines: parseManualLines(str(form, 'lines')),
      deliveryFeePaise: rupees(form, 'deliveryFee'),
      paymentMode: str(form, 'paymentMode') === 'offline' ? 'offline' : 'online',
      isTest: str(form, 'isTest') === '1',
      notes: str(form, 'notes') || null,
    });
    const link = created.paymentUrl ? `&link=${encodeURIComponent(created.paymentUrl)}` : '';
    return `/admin/orders/${created.id}?done=created${link}`;
  });
}

/** Bulk status move from the orders index (row checkboxes): each order goes through the same guarded transition; refused ones are counted, not fatal. */
async function bulkMove(form: FormData, to: 'confirmed' | 'packed'): Promise<never> {
  const ids = form.getAll('ids').map(String).slice(0, 200);
  let moved = 0;
  for (const orderId of ids) {
    try {
      await staffTransition({ orderId, to });
      moved++;
    } catch (err) {
      if (!errorCode(err)) throw err;
    }
  }
  revalidatePath('/admin/orders');
  redirect(`/admin/orders?done=bulk&n=${moved}&skipped=${ids.length - moved}`);
}

export async function bulkConfirmAction(form: FormData): Promise<never> {
  return bulkMove(form, 'confirmed');
}

export async function bulkPackAction(form: FormData): Promise<never> {
  return bulkMove(form, 'packed');
}
