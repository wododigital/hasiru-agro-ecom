import type { NotificationChannel, Recipient, TemplateKey } from '@ecomkit/core/contracts';
import { NotConfiguredError } from '@ecomkit/core/http';
import { newId } from '@ecomkit/core/ids';
import { authDeps } from './config';

/** Development fallback when no notifications module is enabled: the message goes to the server log. */
const devLogChannel: NotificationChannel = {
  id: 'log',
  adapter: 'dev-log',
  async send(message) {
    console.info(`[auth] ${message.templateKey} to ${message.to}\n${message.text}`);
    return { status: 'sent', providerMessageId: null, error: null };
  },
};

/**
 * Sends a templated message. Prefers the notifications service (it owns templates, channels, opt-out and logs);
 * without it, a configured raw channel gets the variables as plain text. Production without either throws.
 */
export async function deliver(templateKey: TemplateKey, to: Recipient, vars: Readonly<Record<string, string>>): Promise<void> {
  const deps = authDeps();
  const sender = (await deps.notifications?.()) ?? null;
  if (sender) {
    await sender.send(templateKey, to, vars);
    return;
  }
  const channel = deps.channel ?? (process.env.NODE_ENV === 'production' ? null : devLogChannel);
  const address = to.phone ?? to.email;
  if (!channel || !address) throw new NotConfiguredError('notifications');
  const text = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const result = await channel.send({
    messageId: newId(),
    channel: channel.id,
    to: address,
    templateKey,
    locale: 'en-IN',
    subject: null,
    text,
    html: null,
    whatsapp: null,
  });
  if (result.status === 'failed') throw new Error(`delivery failed: ${result.error ?? 'unknown'}`);
}
