'use server';

import { NotFoundError } from '@ecomkit/core/auth-context';
import { formDataToObject } from '@ecomkit/core/validation';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { deleteMyReview, updateMyReview } from '../server';

async function run(ok: string, write: () => Promise<unknown>): Promise<never> {
  let outcome = ok;
  try {
    await write();
  } catch (err) {
    if (err instanceof ZodError) outcome = 'invalid';
    else if (err instanceof NotFoundError) outcome = 'not_found';
    else throw err;
  }
  revalidatePath('/account/reviews');
  redirect(`/account/reviews?review=${outcome}`);
}

export async function updateReviewAction(form: FormData): Promise<never> {
  return run('saved', () => updateMyReview(String(form.get('id') ?? ''), formDataToObject(form)));
}

export async function deleteReviewAction(form: FormData): Promise<never> {
  return run('deleted', () => deleteMyReview(String(form.get('id') ?? '')));
}
