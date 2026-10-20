'use server';

import { formDataToObject } from '@ecomkit/core/validation';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteTag, saveTag } from '../server/tags';

const BASE = '/admin/marketing/tags';

export async function saveTagAction(form: FormData): Promise<void> {
  const raw = formDataToObject(form);
  let target = `${BASE}?saved=1`;
  try {
    await saveTag(raw);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`).join('; ') : 'could not save';
    target = `${BASE}?${new URLSearchParams({ error: message.slice(0, 300), ...(raw.id ? { edit: String(raw.id) } : {}) })}`;
  }
  redirect(target);
}

export async function deleteTagAction(form: FormData): Promise<void> {
  await deleteTag(String(form.get('id') ?? ''));
  redirect(`${BASE}?deleted=1`);
}
