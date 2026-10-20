'use server';

import { revalidatePath } from 'next/cache';
import { moderate } from '../server';

/** Row buttons post `decision` = "<approved|rejected>:<review id>" with that row's `reply:<id>` textarea (the rows share the index's one form). */
export async function moderateAction(form: FormData): Promise<void> {
  const [decision, id = ''] = String(form.get('decision') ?? '').split(':');
  await moderate(id, { decision, reply: form.get(`reply:${id}`) ?? undefined });
  revalidatePath('/admin/reviews');
}

/** Bulk approve or reject the ticked rows, each with its own reply; bound per button and checked by `moderate`'s schema. */
export async function bulkModerateAction(decision: string, form: FormData): Promise<void> {
  for (const id of form.getAll('ids').map(String).slice(0, 200)) await moderate(id, { decision, reply: form.get(`reply:${id}`) ?? undefined });
  revalidatePath('/admin/reviews');
}
