'use server';

import { NotFoundError } from '@ecomkit/core/auth-context';
import { formDataToObject } from '@ecomkit/core/validation';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { deleteMyAddress, deleteMyLand, saveMyAddress, saveMyLand, updateMyProfile } from '../server';

/**
 * Account form actions. Plain <form action> posts, so they work without JS: the outcome comes back as a
 * query flag on the same page (`?saved=1`, `?error=invalid|not_found`). The server functions validate with zod.
 */
async function run(path: string, write: () => Promise<unknown>): Promise<never> {
  let outcome = 'saved=1';
  try {
    await write();
  } catch (err) {
    if (err instanceof ZodError) outcome = 'error=invalid';
    else if (err instanceof NotFoundError) outcome = 'error=not_found';
    else throw err;
  }
  revalidatePath(path);
  redirect(`${path}?${outcome}`);
}

export async function saveProfileAction(form: FormData): Promise<never> {
  return run('/account/profile', () => updateMyProfile(formDataToObject(form)));
}

export async function saveAddressAction(form: FormData): Promise<never> {
  return run('/account/addresses', () => saveMyAddress(formDataToObject(form)));
}

export async function deleteAddressAction(form: FormData): Promise<never> {
  return run('/account/addresses', () => deleteMyAddress(String(form.get('id') ?? '')));
}

export async function saveLandAction(form: FormData): Promise<never> {
  return run('/account/land', () => saveMyLand(formDataToObject(form)));
}

export async function deleteLandAction(form: FormData): Promise<never> {
  return run('/account/land', () => deleteMyLand(String(form.get('id') ?? '')));
}
