'use server';

import { revalidatePath } from 'next/cache';
import { moderate } from '../server';

export async function moderateAction(form: FormData): Promise<void> {
  await moderate(String(form.get('id') ?? ''), { decision: form.get('decision'), reply: form.get('reply') ?? undefined });
  revalidatePath('/admin/reviews');
}
