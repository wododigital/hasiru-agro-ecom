import { TEMPLATE_KEYS } from '@ecomkit/core/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  STORE_NAME_VAR,
  MissingTemplateVariableError,
  backoffMs,
  buildMime,
  classifyWhatsappError,
  fillTemplate,
  inServiceWindow,
  maskAddress,
  nextStatus,
  optKeyword,
  parseMime,
  quietHoursRelease,
  templateCreatePayload,
  templatePayload,
  templateVariables,
  webhookItems,
  whatsappEndpoint,
  whatsappTemplateName,
} from '../src/domain';

const at = (iso: string) => new Date(iso);

describe('template catalogue', () => {
  it('has a default for every frozen template key, keyed consistently', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort());
    for (const key of TEMPLATE_KEYS) expect(DEFAULT_TEMPLATES[key].key).toBe(key);
  });

  it('copy rules: no em dashes, no release words, store name only as a variable, valid WhatsApp names', () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      const all = `${t.subject}\n${t.body}`;
      expect(all).not.toMatch(/\u2014/);
      expect(all).not.toMatch(/\b(phase|v1|v2)\b/i);
      expect(all).not.toMatch(/hasiru/i);
      expect(whatsappTemplateName(t.key)).toMatch(/^[a-z0-9_]+$/);
      // Every subject variable also appears in the body (WhatsApp and SMS carry only the body).
      for (const v of templateVariables(t.subject)) expect(templateVariables(t.body)).toContain(v);
      expect(templateVariables(t.body)).toContain(STORE_NAME_VAR);
    }
  });

  it('categories: OTP is authentication, reminders and follow-ups are marketing, the rest utility', () => {
    const byCategory = (c: string) => TEMPLATE_KEYS.filter((k) => DEFAULT_TEMPLATES[k].category === c);
    expect(byCategory('authentication')).toEqual(['otp.login', 'otp.unlock']);
    expect(byCategory('marketing')).toEqual(['cart.reminder_1', 'cart.reminder_2', 'cart.reminder_3', 'review.request', 'stock.back_in_stock', 'lead.follow_up']);
    // Marketing copy always tells people how to stop it.
    for (const k of byCategory('marketing')) expect(DEFAULT_TEMPLATES[k].body).toMatch(/Reply STOP to stop these messages\.$/);
  });

  it('exact text of every template (pinned)', () => {
    const rendered = Object.fromEntries(
      TEMPLATE_KEYS.map((key) => {
        const t = DEFAULT_TEMPLATES[key];
        const vars = Object.fromEntries(templateVariables(t.subject, t.body).map((v) => [v, v === STORE_NAME_VAR ? 'Acme Store' : `<${v}>`]));
        return [key, `${fillTemplate(key, t.subject, vars)} | ${fillTemplate(key, t.body, vars)}`];
      }),
    );
    expect(rendered).toMatchInlineSnapshot(`
      {
        "alert.critical": "Critical: <title> | Critical alert at Acme Store: <title>
      <detail>
      Open: <admin_link>",
        "alert.digest": "Acme Store alerts: <count> open | <count> open alerts at Acme Store.
      <summary>
      Open: <admin_link>",
        "cart.reminder_1": "You left something in your cart | Hi <name>, you left some items in your cart at Acme Store. Pick up where you left off: <cart_link>
      Reply STOP to stop these messages.",
        "cart.reminder_2": "Your cart is still saved | Hi <name>, your cart at Acme Store is still saved for you. Questions before you order? Reply here and we will help. <cart_link>
      Reply STOP to stop these messages.",
        "cart.reminder_3": "A last reminder about your cart | Hi <name>, this is our last reminder about your cart at Acme Store. It stays saved here: <cart_link>
      Reply STOP to stop these messages.",
        "enquiry.received_admin": "New <enquiry_type> enquiry from <name> | New <enquiry_type> enquiry at Acme Store from <name> (<phone>). Open it in admin: <admin_link>",
        "enquiry.received_customer": "We received your enquiry | Hi <name>, thank you for your <enquiry_type> enquiry. The Acme Store team will get back to you soon.",
        "lead.follow_up": "Thank you for your interest in Acme Store | Hi <name>, thank you for your interest in Acme Store. You can pick up where you left off here: <link> Reply to this message if you would like help from our team.
      Reply STOP to stop these messages.",
        "order.confirmed": "Order <order_number> confirmed | Hi <name>, thank you for your order <order_number> with Acme Store. Order total: <total>. We will message you when it is packed. View your order: <order_link>",
        "order.delivered": "Order <order_number> delivered | Hi <name>, your order <order_number> has been delivered. If anything is not right, reply to this message and the Acme Store team will help.",
        "order.dispatched": "Order <order_number> is on its way | Hi <name>, your order <order_number> has been dispatched. Expected delivery: <delivery_date>. Thank you for shopping with Acme Store.",
        "order.packed": "Order <order_number> is packed | Hi <name>, your order <order_number> is packed and will be on its way soon. Thank you for shopping with Acme Store.",
        "order.payment_failed": "Payment not confirmed for order <order_number> | Hi <name>, we could not confirm the payment for order <order_number>. You can try again here: <pay_link> If money was deducted, reply to this message and the Acme Store team will sort it out.",
        "order.replacement_created": "Replacement order <replacement_number> created | Hi <name>, we have created replacement order <replacement_number> for your order <order_number>. Acme Store will message you when it is dispatched.",
        "otp.login": "Your Acme Store sign-in code | Your Acme Store sign-in code is <code>. It expires in 5 minutes. Do not share it with anyone.",
        "otp.unlock": "Your Acme Store verification code | Your Acme Store verification code is <code>. It expires in 5 minutes. Do not share it with anyone.",
        "review.request": "How did your order turn out? | Hi <name>, how did your order <order_number> from Acme Store turn out? A short review helps other customers: <review_link>
      Reply STOP to stop these messages.",
        "slot.reminder": "Delivery reminder for order <order_number> | Hi <name>, a reminder from Acme Store: your order <order_number> is scheduled for delivery on <slot_date>, <slot_window>. Please make sure someone is available to receive it.",
        "staff.invite": "You are invited to the Acme Store admin | Hi <name>, you have been invited to the Acme Store admin as <role>. Set your password here: <link>
      If you were not expecting this, ignore this message.",
        "stock.back_in_stock": "<product_name> is back in stock | Good news: <product_name> is back in stock at Acme Store. See it here: <product_link>
      Reply STOP to stop these messages.",
        "test.send": "Test message from Acme Store | This is a test message from Acme Store, sent at <sent_at>. If you can read this, the channel works.",
      }
    `);
  });

  it('refuses to render with a missing variable', () => {
    expect(() => fillTemplate('order.packed', DEFAULT_TEMPLATES['order.packed'].body, { name: 'Asha', store_name: 'S' })).toThrow(MissingTemplateVariableError);
  });
});

describe('rules', () => {
  const window = { start: '21:00', end: '09:00' };
  it('quiet hours hold marketing only, wrap midnight, release at the end time (IST)', () => {
    expect(quietHoursRelease(at('2026-10-20T10:00:00+05:30'), 'marketing', window)).toBeNull();
    expect(quietHoursRelease(at('2026-10-20T22:30:00+05:30'), 'marketing', window)?.toISOString()).toBe(at('2026-10-21T09:00:00+05:30').toISOString());
    expect(quietHoursRelease(at('2026-10-21T08:59:00+05:30'), 'marketing', window)?.toISOString()).toBe(at('2026-10-21T09:00:00+05:30').toISOString());
    expect(quietHoursRelease(at('2026-10-20T21:00:00+05:30'), 'marketing', window)).not.toBeNull();
    expect(quietHoursRelease(at('2026-10-20T22:30:00+05:30'), 'utility', window)).toBeNull();
    expect(quietHoursRelease(at('2026-10-20T22:30:00+05:30'), 'authentication', window)).toBeNull();
    expect(quietHoursRelease(at('2026-10-20T13:30:00+05:30'), 'marketing', { start: '13:00', end: '14:00' })?.toISOString()).toBe(at('2026-10-20T14:00:00+05:30').toISOString());
    expect(quietHoursRelease(at('2026-10-20T22:30:00+05:30'), 'marketing', { start: '00:00', end: '00:00' })).toBeNull();
  });

  it('opt-out keywords', () => {
    expect(optKeyword(' STOP ')).toBe('stop');
    expect(optKeyword('Stop.')).toBe('stop');
    expect(optKeyword('unsubscribe')).toBe('stop');
    expect(optKeyword('start')).toBe('start');
    expect(optKeyword('please stop by tomorrow')).toBeNull();
  });

  it('24 h service window', () => {
    const now = at('2026-10-20T10:00:00+05:30');
    expect(inServiceWindow(null, now)).toBe(false);
    expect(inServiceWindow(at('2026-10-19T10:00:01+05:30'), now)).toBe(true);
    expect(inServiceWindow(at('2026-10-19T10:00:00+05:30'), now)).toBe(false);
  });

  it('routing by category: marketing to the Marketing Messages API, the rest to /messages', () => {
    expect(whatsappEndpoint('marketing', true)).toBe('marketing_messages');
    expect(whatsappEndpoint('marketing', false)).toBe('messages');
    expect(whatsappEndpoint('utility', true)).toBe('messages');
    expect(whatsappEndpoint('authentication', true)).toBe('messages');
  });

  it('error handling: 131049 pauses marketing 24 h, 130429 and 5xx retry, the rest are permanent', () => {
    expect(classifyWhatsappError(131049, 200)).toBe('suppress_marketing_24h');
    expect(classifyWhatsappError(130429, 400)).toBe('retry');
    expect(classifyWhatsappError(null, 503)).toBe('retry');
    expect(classifyWhatsappError(null, 429)).toBe('retry');
    expect(classifyWhatsappError(131026, 200)).toBe('permanent');
    expect(classifyWhatsappError(190, 401)).toBe('permanent');
  });

  it('status never moves backwards; failed wins', () => {
    expect(nextStatus('read', 'delivered')).toBe('read');
    expect(nextStatus('sent', 'read')).toBe('read');
    expect(nextStatus('queued', 'sent')).toBe('sent');
    expect(nextStatus('delivered', 'failed')).toBe('failed');
  });

  it('masking and backoff', () => {
    expect(maskAddress('+919876543210')).toBe('+91•••••43210');
    expect(maskAddress('asha@example.com')).toBe('a•••@example.com');
    expect(backoffMs(0, 32, 0)).toBe(1000);
    expect(backoffMs(3, 32, 0.5)).toBe(8500);
    expect(backoffMs(10, 32, 0)).toBe(32_000);
  });
});

describe('WhatsApp payloads and webhooks', () => {
  it('template sends use named params; OTP uses the preset body plus the copy-code button', () => {
    expect(templatePayload({ to: '+919876543210', name: 'order_packed', language: 'en', category: 'utility', params: { name: 'Asha', order_number: 'A-1' } })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+919876543210',
      type: 'template',
      template: {
        name: 'order_packed',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'name', text: 'Asha' }, { type: 'text', parameter_name: 'order_number', text: 'A-1' }] }],
      },
    });
    const otp = templatePayload({ to: '+919876543210', name: 'otp_login', language: 'en', category: 'authentication', params: { code: '123456', store_name: 'S' } });
    expect((otp.template as { components: unknown[] }).components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
    ]);
  });

  it('template create payload carries named examples; authentication uses the preset components', () => {
    const p = templateCreatePayload('order_packed', 'utility', 'en', DEFAULT_TEMPLATES['order.packed'].body);
    expect(p).toMatchObject({ name: 'order_packed', category: 'UTILITY', parameter_format: 'named' });
    expect(JSON.stringify(p)).toContain('"param_name":"order_number"');
    expect(templateCreatePayload('otp_login', 'authentication', 'en', '')).toMatchObject({ category: 'AUTHENTICATION', components: [{ type: 'BODY', add_security_recommendation: true }, { type: 'FOOTER', code_expiration_minutes: 5 }, { type: 'BUTTONS' }] });
  });

  it('splits a delivery into items with dedupe keys (wamid + status, inbound wamid, template event)', () => {
    const items = webhookItems({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.A', status: 'sent', timestamp: '1' }, { id: 'wamid.A', status: 'delivered', timestamp: '2' }, { bogus: true }], messages: [{ id: 'wamid.B', from: '919876543210', timestamp: '3', type: 'text', text: { body: 'STOP' } }] } },
            { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'order_packed', message_template_id: 7 } },
          ],
        },
      ],
    });
    expect(items.map((i) => i.dedupeKey)).toEqual(['wa:wamid.A:sent', 'wa:wamid.A:delivered', 'wa:in:wamid.B', 'wa:tpl:order_packed:APPROVED:7:waba']);
    expect(webhookItems({ nope: 1 })).toEqual([]);
  });
});

describe('MIME', () => {
  it('round-trips UTF-8 subject and parts, and strips header injection', () => {
    const raw = buildMime({ from: 'shop@example.test', fromName: 'Acme Store', to: 'a@example.com\r\nBcc: evil@example.com', subject: 'Order ₹ confirmed\r\nX-Evil: 1', text: 'Hello\nthere', html: '<p>Hello</p>', messageId: 'm1' });
    expect(raw).not.toMatch(/\r\nBcc: evil/);
    expect(raw).not.toMatch(/\r\nX-Evil/);
    const parsed = parseMime(raw);
    expect(parsed.headers.subject).toBe('Order ₹ confirmed X-Evil: 1');
    expect(parsed.headers.from).toBe('Acme Store <shop@example.test>');
    expect(parsed.text).toBe('Hello\nthere');
    expect(parsed.html).toBe('<p>Hello</p>');
  });
});
