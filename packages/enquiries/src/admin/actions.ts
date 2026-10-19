'use server';

import { getViewer } from '@ecomkit/core/auth-context';
import { revalidatePath } from 'next/cache';
import { ENQUIRY_STATUSES, type EnquiryStatus } from '../domain';
import { addNote, assign, transition } from '../server';

const back = (id: string) => {
  revalidatePath(`/admin/enquiries/${id}`);
  revalidatePath('/admin/enquiries');
};

export async function transitionAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const to = String(form.get('status'));
  if (!ENQUIRY_STATUSES.includes(to as EnquiryStatus)) return;
  await transition(id, to as EnquiryStatus);
  back(id);
}

export async function addNoteAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  await addNote(id, String(form.get('body') ?? ''));
  back(id);
}

/** "Assign to me" / "Unassign" (a staff picker needs the auth module's staff list). */
export async function assignAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const viewer = await getViewer();
  await assign(id, form.get('clear') ? null : viewer.kind === 'staff' ? viewer.userId : null);
  back(id);
}
