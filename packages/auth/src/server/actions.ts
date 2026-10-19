'use server';

import { headers as nextHeaders } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '../domain';
import { clientIp } from './config';
import { sendOtp, verifyOtp } from './otp';
import { acceptInvite, beginTotpEnrolment, confirmTotpEnrolment, signInStaff, signOut, verifyStaffSecondFactor } from './staff';

// Form actions for the sign-in pages. Session cookies are written by Better Auth's next-cookies plugin.

export type CustomerLoginState = {
  step: 'start' | 'code';
  identifier: string;
  error: null | 'invalid_identifier' | 'invalid_code' | 'rate_limited';
  retryAfterSec?: number;
  resent?: boolean;
};

export type StaffLoginState = {
  step: 'password' | 'second_factor' | 'enrol' | 'enrol_confirm' | 'invite';
  method?: 'totp' | 'backup';
  enrolment?: { secret: string; totpURI: string; backupCodes: string[] };
  inviteToken?: string;
  notice?: 'invite_done';
  error: null | 'invalid' | 'locked' | 'rate_limited' | 'code_invalid' | 'invite_invalid';
  retryAfterSec?: number;
};

const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
};

async function current(): Promise<Headers> {
  return new Headers(await nextHeaders());
}

export async function customerLoginAction(prev: CustomerLoginState, form: FormData): Promise<CustomerLoginState> {
  if (field(form, 'intent') === 'reset') return { step: 'start', identifier: '', error: null };
  const headers = await current();
  const identifier = field(form, 'identifier') || prev.identifier;
  if (field(form, 'intent') === 'verify') {
    const result = await verifyOtp({ identifier, code: field(form, 'code'), requestHeaders: headers });
    if (result.status === 'ok') redirect(safeNextPath(field(form, 'next'), '/account'));
    return result.status === 'rate_limited'
      ? { step: 'code', identifier, error: 'rate_limited', retryAfterSec: result.retryAfterSec }
      : { step: 'code', identifier, error: 'invalid_code' };
  }
  const result = await sendOtp({ identifier, ip: clientIp(headers) });
  if (result.status === 'invalid') return { step: 'start', identifier, error: 'invalid_identifier' };
  if (result.status === 'rate_limited') return { step: prev.step, identifier, error: 'rate_limited', retryAfterSec: result.retryAfterSec };
  return { step: 'code', identifier, error: null, resent: prev.step === 'code' };
}

export async function staffLoginAction(prev: StaffLoginState, form: FormData): Promise<StaffLoginState> {
  const headers = await current();
  const intent = field(form, 'intent');

  if (intent === 'accept_invite') {
    const token = field(form, 'invite') || prev.inviteToken || '';
    const result = await acceptInvite({ token, password: field(form, 'password') });
    return result.status === 'ok' ? { step: 'password', notice: 'invite_done', error: null } : { step: 'invite', inviteToken: token, error: 'invite_invalid' };
  }

  if (intent === 'second_factor') {
    const method = field(form, 'method') === 'backup' ? 'backup' : 'totp';
    const result = await verifyStaffSecondFactor({ code: field(form, 'code'), method, requestHeaders: headers });
    if (result.status === 'ok') redirect('/admin');
    return { step: 'second_factor', method, error: 'code_invalid' };
  }

  if (intent === 'enrol_start') {
    const result = await beginTotpEnrolment({ password: field(form, 'password'), requestHeaders: headers });
    if (result.status !== 'ok') return { step: 'enrol', error: 'invalid' };
    return { step: 'enrol_confirm', enrolment: { secret: result.secret, totpURI: result.totpURI, backupCodes: result.backupCodes }, error: null };
  }

  if (intent === 'enrol_confirm') {
    const result = await confirmTotpEnrolment({ code: field(form, 'code'), requestHeaders: headers });
    if (result.status === 'ok') redirect('/admin');
    return { ...prev, step: 'enrol_confirm', error: 'code_invalid' };
  }

  const result = await signInStaff({ email: field(form, 'email'), password: field(form, 'password'), ip: clientIp(headers), requestHeaders: headers });
  switch (result.status) {
    case 'two_factor':
      return { step: 'second_factor', method: 'totp', error: null };
    case 'enrol':
      return { step: 'enrol', error: null };
    case 'locked':
    case 'rate_limited':
      return { step: 'password', error: result.status, retryAfterSec: result.retryAfterSec };
    default:
      return { step: 'password', error: 'invalid' };
  }
}

export async function signOutAction(form: FormData): Promise<void> {
  await signOut(await current());
  redirect(safeNextPath(field(form, 'next'), '/'));
}
