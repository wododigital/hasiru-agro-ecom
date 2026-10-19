'use server';

import { revalidatePath } from 'next/cache';
import { LEAD_STATUSES, type LeadStatus } from '../domain';
import { setLeadStatus } from '../server';

export async function setLeadStatusAction(form: FormData): Promise<void> {
  const status = String(form.get('status'));
  if (!LEAD_STATUSES.includes(status as LeadStatus)) return;
  await setLeadStatus(String(form.get('id') ?? ''), status as LeadStatus);
  revalidatePath('/admin/leads');
}
