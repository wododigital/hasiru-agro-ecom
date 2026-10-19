import type { ChannelId, HealthResult, SettingsActionResult } from '@ecomkit/core/contracts';
import { db } from '@ecomkit/core/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { notificationsMessage } from '../schema';
import { createWhatsappChannel, gmailConfig, whatsappConfig } from './channels';
import { loadSettings } from './config';
import { deliver, queueMessages } from './sender';
import { blockedTemplates, submitWhatsappTemplates, syncWhatsappTemplates } from './whatsapp';

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** Sends `test.send` to the admin address on one channel and delivers it at once, so the button shows the real outcome. */
async function testSend(channel: ChannelId): Promise<SettingsActionResult> {
  const s = await loadSettings();
  const to = channel === 'email' ? s.adminEmail : s.adminPhone;
  if (!to) return { ok: false, message: `Set the admin ${channel === 'email' ? 'email' : 'phone'} first.` };
  const { queued } = await queueMessages('test.send', channel === 'email' ? { email: to } : { phone: to }, { sent_at: IST.format(new Date()) }, { channel, isTest: true });
  const job = queued[0];
  if (!job) return { ok: false, message: 'The message was not queued (check opt-outs and the kill switch).' };
  const result = await deliver(job, { attempt: 99 });
  if (!result) return { ok: false, message: 'The message was already handled.' };
  if (result.status === 'sent') return { ok: true, message: `Test ${channel === 'email' ? 'email' : 'message'} sent to ${to}.` };
  if (result.status === 'skipped_not_configured') return { ok: false, message: `${channel === 'email' ? 'Email' : 'WhatsApp'} is off or not configured.` };
  return { ok: false, message: `Not sent: ${result.error ?? 'unknown error'}` };
}

export const testEmailAction = (): Promise<SettingsActionResult> => testSend('email');
export async function testWhatsappAction(): Promise<SettingsActionResult> {
  const s = await loadSettings();
  const probe = await createWhatsappChannel(s).testConnection!();
  if (!probe.ok || !s.adminPhone) return probe;
  return testSend('whatsapp');
}
export const syncTemplatesAction = async (): Promise<SettingsActionResult> => syncWhatsappTemplates();
export const submitTemplatesAction = async (): Promise<SettingsActionResult> => submitWhatsappTemplates();

// ---- health checks -------------------------------------------------------------------------------
/** Failed share of the last hour's sends on a channel (monitoring alerts above 20%). */
async function failureRate(channel: ChannelId): Promise<{ total: number; failed: number }> {
  const since = new Date(Date.now() - 3600_000);
  const [row] = await db
    .select({ total: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where ${notificationsMessage.status} = 'failed')::int` })
    .from(notificationsMessage)
    .where(and(eq(notificationsMessage.channel, channel), gt(notificationsMessage.queuedAt, since), sql`${notificationsMessage.status} <> 'skipped'`));
  return row ?? { total: 0, failed: 0 };
}

const mocksOff = () => process.env.ENABLE_MOCKS !== '1' && process.env.NODE_ENV === 'production';

async function channelHealth(channel: 'email' | 'whatsapp'): Promise<HealthResult> {
  const s = await loadSettings();
  const mode = channel === 'email' ? s.emailMode : s.whatsappMode;
  if (mode === 'off') return { status: 'not_configured', detail: 'off' };
  if (mode === 'mock' && mocksOff()) return { status: 'degraded', detail: 'mock mode in production: nothing is delivered' };
  if (!(channel === 'email' ? gmailConfig(s) : whatsappConfig(s))) return { status: 'not_configured', detail: channel === 'email' ? 'Gmail not connected' : 'credentials missing' };
  const { total, failed } = await failureRate(channel);
  const notes: string[] = [];
  if (channel === 'whatsapp') {
    const blocked = await blockedTemplates();
    if (blocked.length) notes.push(`templates blocked: ${blocked.join(', ')}`);
  }
  if (total >= 5 && failed / total > 0.2) return { status: 'down', detail: `${failed} of ${total} sends failed in the last hour` };
  return { status: notes.length ? 'degraded' : 'ok', detail: notes.join('; ') || `${mode}, ${total} sends in the last hour` };
}

export const emailHealth = () => channelHealth('email');
export const whatsappHealth = () => channelHealth('whatsapp');

/** The OTP kill switch blocks every sign-in code: shown as a warning while it is on. */
export async function otpHealth(): Promise<HealthResult> {
  const s = await loadSettings();
  return s.otpKillSwitch ? { status: 'degraded', detail: 'OTP kill switch is on: customers cannot receive sign-in codes' } : { status: 'ok' };
}
