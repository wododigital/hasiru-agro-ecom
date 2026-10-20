// Pure flow definitions: the fixed flows, their settings schema, the steps built from settings, quiet-hour shifts.
import { TEMPLATE_KEYS, type TemplateKey } from '@ecomkit/core/contracts';
import { DEFAULT_TEMPLATES, quietHoursRelease } from '@ecomkit/notifications/domain';
import { z } from 'zod';

export const FLOW_KEYS = ['abandoned_cart', 'order_updates', 'slot_reminder', 'review_request', 'back_in_stock', 'wizard_lead_follow_up'] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export type FlowTrigger =
  | 'cart_abandoned'
  | 'order_placed'
  | 'order_paid'
  | 'order_dispatched'
  | 'order_delivered'
  | 'slot_reminder'
  | 'back_in_stock'
  | 'wizard_lead_no_order'
  | 'review_request';

/** Why a run ended early. The first five are decided when the run starts (zero messages). */
export const STOP_REASONS = [
  'no_contact',
  'no_consent',
  'frequency_cap',
  'subject_missing',
  'order_cancelled',
  'purchased',
  'replied',
  'unsubscribed',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const FLOW_CHANNELS = ['whatsapp', 'email', 'both'] as const;
export type FlowChannel = (typeof FLOW_CHANNELS)[number];

const HHMM = '([01]\\d|2[0-3]):[0-5]\\d';
export const QUIET_WINDOW_RE = new RegExp(`^${HHMM}-${HHMM}$`);

export const stepSettingSchema = z.object({
  enabled: z.boolean(),
  templateKey: z.enum(TEMPLATE_KEYS),
  channel: z.enum(FLOW_CHANNELS),
  /** Minutes after the run starts (the abandonment, the delivery, the lead). */
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30),
});
export type StepSetting = z.infer<typeof stepSettingSchema>;

export const flowSettingsSchema = z.object({
  steps: z.array(stepSettingSchema).min(1).max(4),
  /** IST windows (`HH:MM-HH:MM`, may wrap midnight) a scheduled message is moved out of, to the window's end. */
  quietHours: z.array(z.string().regex(QUIET_WINDOW_RE)).max(4),
  /** Sequences per contact per 7 days; 0 means no cap. */
  maxPer7Days: z.number().int().min(0).max(10),
  /** Discount rule for the single-use code on the offer step (abandoned cart only); null means no code. */
  discountRuleId: z.uuid().nullable(),
  codeValidHours: z.number().int().min(1).max(24 * 7),
});
export type FlowSettings = z.infer<typeof flowSettingsSchema>;

export interface FlowDef {
  key: FlowKey;
  name: string;
  trigger: FlowTrigger;
  description: string;
  /** Templates the admin may pick per step (same length as the default steps). */
  templates: readonly (readonly TemplateKey[])[];
  /** Marketing flows need recorded marketing consent and stop on unsubscribe. */
  needsConsent: boolean;
  /** Stop when the contact places an order or replies after the run started. */
  stopOnPurchase: boolean;
  stopOnReply: boolean;
  /** Index of the step that may carry the single-use code, or null. */
  offerStep: number | null;
  defaults: FlowSettings;
}

const step = (templateKey: TemplateKey, delayMinutes: number, channel: FlowChannel = 'both'): StepSetting => ({ enabled: true, templateKey, channel, delayMinutes });
const base = { quietHours: [] as string[], maxPer7Days: 0, discountRuleId: null, codeValidHours: 48 };
const HOUR = 60;
const DAY = 24 * HOUR;
const CART_TEMPLATES = ['cart.reminder_1', 'cart.reminder_2', 'cart.reminder_3'] as const;

export const FLOW_DEFS: Readonly<Record<FlowKey, FlowDef>> = {
  abandoned_cart: {
    key: 'abandoned_cart',
    name: 'Abandoned cart',
    trigger: 'cart_abandoned',
    description: 'Up to three reminders after a cart is left with a known contact and marketing consent. Stops on purchase, reply or unsubscribe.',
    templates: [CART_TEMPLATES, CART_TEMPLATES, CART_TEMPLATES],
    needsConsent: true,
    stopOnPurchase: true,
    stopOnReply: true,
    offerStep: 2,
    defaults: {
      steps: [step('cart.reminder_1', 1 * HOUR), step('cart.reminder_2', 24 * HOUR), step('cart.reminder_3', 72 * HOUR)],
      quietHours: ['09:00-11:00', '18:30-21:00'],
      maxPer7Days: 1,
      discountRuleId: null,
      codeValidHours: 48,
    },
  },
  order_updates: {
    key: 'order_updates',
    name: 'Order updates',
    trigger: 'order_placed',
    description: 'Confirmed, packed, dispatched and delivered messages, each sent when the order reaches that status.',
    templates: [['order.confirmed'], ['order.packed'], ['order.dispatched'], ['order.delivered']],
    needsConsent: false,
    stopOnPurchase: false,
    stopOnReply: false,
    offerStep: null,
    defaults: { ...base, steps: [step('order.confirmed', 0), step('order.packed', 0), step('order.dispatched', 0), step('order.delivered', 0)] },
  },
  slot_reminder: {
    key: 'slot_reminder',
    name: 'Delivery slot reminder',
    trigger: 'slot_reminder',
    description: 'A reminder the day before the delivery slot, for every order in the slot.',
    templates: [['slot.reminder']],
    needsConsent: false,
    stopOnPurchase: false,
    stopOnReply: false,
    offerStep: null,
    defaults: { ...base, steps: [step('slot.reminder', 0, 'whatsapp')] },
  },
  review_request: {
    key: 'review_request',
    name: 'Review request',
    trigger: 'review_request',
    description: 'Asks for a review a few days after delivery. Skipped for cancelled or refunded orders.',
    templates: [['review.request']],
    needsConsent: true,
    stopOnPurchase: false,
    stopOnReply: false,
    offerStep: null,
    defaults: { ...base, steps: [step('review.request', 7 * DAY)] },
  },
  back_in_stock: {
    key: 'back_in_stock',
    name: 'Back in stock',
    trigger: 'back_in_stock',
    description: 'Tells people who asked to be notified that an item is available again. Sent once per request.',
    templates: [['stock.back_in_stock']],
    // The notify-me request itself carries the consent (explicit request plus checkbox).
    needsConsent: false,
    stopOnPurchase: false,
    stopOnReply: false,
    offerStep: null,
    defaults: { ...base, steps: [step('stock.back_in_stock', 0)] },
  },
  wizard_lead_follow_up: {
    key: 'wizard_lead_follow_up',
    name: 'Planner lead follow-up',
    trigger: 'wizard_lead_no_order',
    description: 'One follow-up after a planner lead when no order has been placed. Stops on purchase or reply.',
    templates: [['lead.follow_up']],
    needsConsent: true,
    stopOnPurchase: true,
    stopOnReply: true,
    offerStep: null,
    defaults: { ...base, steps: [step('lead.follow_up', 48 * HOUR, 'whatsapp')] },
  },
};

export const isFlowKey = (value: string): value is FlowKey => (FLOW_KEYS as readonly string[]).includes(value);

/** True when the template is a marketing message (Meta category; routed through Marketing Messages). */
export const isMarketingTemplate = (key: TemplateKey): boolean => DEFAULT_TEMPLATES[key].category === 'marketing';

/** Validates settings for one flow: the shared schema plus the flow's step count, template choices and offer rule. */
export function parseFlowSettings(key: FlowKey, input: unknown): FlowSettings {
  const def = FLOW_DEFS[key];
  return flowSettingsSchema
    .superRefine((s, ctx) => {
      if (s.steps.length !== def.templates.length) ctx.addIssue({ code: 'custom', path: ['steps'], message: `this flow has ${def.templates.length} step(s)` });
      s.steps.forEach((st, i) => {
        if (def.templates[i] && !def.templates[i]!.includes(st.templateKey)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'templateKey'], message: 'template not allowed for this step' });
      });
      if (def.offerStep === null && s.discountRuleId) ctx.addIssue({ code: 'custom', path: ['discountRuleId'], message: 'this flow has no offer step' });
      // Back in stock is sent while the request's contact is in hand (it is never stored), so it cannot wait.
      if (key === 'back_in_stock' && s.steps.some((st) => st.delayMinutes !== 0)) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'back in stock is sent at once' });
    })
    .parse(input);
}

export interface StepSpec {
  position: number;
  kind: 'wait' | 'stop_if' | 'send_whatsapp' | 'send_email';
  config: StepConfig;
}
export interface StepConfig {
  enabled: boolean;
  /** Index of the settings step this row belongs to. */
  stage: number;
  minutes?: number;
  templateKey?: TemplateKey;
  offer?: boolean;
}

/** Rows per settings step: wait, stop_if, send_whatsapp, send_email. Fixed layout, so positions never move. */
export const ROWS_PER_STEP = 4;

/** The flows_step rows for a flow's settings. A disabled stage keeps its rows (disabled) so positions stay stable. */
export function buildSteps(key: FlowKey, settings: FlowSettings): StepSpec[] {
  const offerStep = FLOW_DEFS[key].offerStep;
  return settings.steps.flatMap((s, stage): StepSpec[] => {
    const p = stage * ROWS_PER_STEP;
    const offer = stage === offerStep && settings.discountRuleId !== null;
    return [
      { position: p, kind: 'wait', config: { enabled: s.enabled, stage, minutes: s.delayMinutes } },
      { position: p + 1, kind: 'stop_if', config: { enabled: s.enabled, stage } },
      { position: p + 2, kind: 'send_whatsapp', config: { enabled: s.enabled && s.channel !== 'email', stage, templateKey: s.templateKey, offer } },
      { position: p + 3, kind: 'send_email', config: { enabled: s.enabled && s.channel !== 'whatsapp', stage, templateKey: s.templateKey, offer } },
    ];
  });
}

/** Parses `HH:MM-HH:MM`. */
export const parseWindow = (w: string) => ({ start: w.slice(0, 5), end: w.slice(6, 11) });

/**
 * Moves an instant out of every quiet window (IST) to that window's end. Windows that touch are crossed in turn
 * (18:30-21:00 then 21:00-09:00 lands at 09:00); a loop of windows covering the whole day returns the input.
 */
export function shiftOutOfQuietHours(at: Date, windows: readonly string[]): Date {
  let t = at;
  for (let i = 0; i <= windows.length; i++) {
    const release = windows.map((w) => quietHoursRelease(t, 'marketing', parseWindow(w))).find((r) => r !== null);
    if (!release) return t;
    t = release;
  }
  return at;
}

/** When a step scheduled `minutes` after the run start may go. */
export const dueAt = (startedAt: Date, minutes: number, quietHours: readonly string[]): Date =>
  shiftOutOfQuietHours(new Date(startedAt.getTime() + minutes * 60_000), quietHours);
