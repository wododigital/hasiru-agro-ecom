import { describe, expect, it } from 'vitest';
import { buildSteps, dueAt, FLOW_DEFS, FLOW_KEYS, parseFlowSettings, ROWS_PER_STEP, shiftOutOfQuietHours } from '../src/domain';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('flow definitions', () => {
  it('every flow default validates and builds 4 stable rows per step', () => {
    for (const key of FLOW_KEYS) {
      const s = parseFlowSettings(key, FLOW_DEFS[key].defaults);
      const steps = buildSteps(key, s);
      expect(steps).toHaveLength(s.steps.length * ROWS_PER_STEP);
      expect(steps.map((x) => x.position)).toEqual(steps.map((_, i) => i));
      expect(steps.filter((x) => x.kind === 'wait')).toHaveLength(s.steps.length);
    }
  });

  it('abandoned cart: 1 h / 24 h / 72 h, max 3 messages per channel, one sequence per 7 days, commute quiet hours', () => {
    const d = FLOW_DEFS.abandoned_cart.defaults;
    expect(d.steps.map((s) => s.delayMinutes)).toEqual([60, 1440, 4320]);
    expect(d.steps.map((s) => s.templateKey)).toEqual(['cart.reminder_1', 'cart.reminder_2', 'cart.reminder_3']);
    expect(d.maxPer7Days).toBe(1);
    expect(d.quietHours).toEqual(['09:00-11:00', '18:30-21:00']);
    expect(FLOW_DEFS.abandoned_cart.needsConsent).toBe(true);
  });

  it('channel maps to send rows; the code only rides on the offer step and only with a rule', () => {
    const base = FLOW_DEFS.abandoned_cart.defaults;
    const noRule = buildSteps('abandoned_cart', base);
    expect(noRule.some((s) => s.config.offer)).toBe(false);
    const withRule = buildSteps('abandoned_cart', {
      ...base,
      discountRuleId: '0192a000-0000-7000-8000-000000000009',
      steps: base.steps.map((s, i) => (i === 0 ? { ...s, channel: 'email' as const } : s)),
    });
    expect(withRule.filter((s) => s.config.offer).map((s) => s.config.stage)).toEqual([2, 2]);
    expect(withRule.find((s) => s.kind === 'send_whatsapp' && s.config.stage === 0)!.config.enabled).toBe(false);
    expect(withRule.find((s) => s.kind === 'send_email' && s.config.stage === 0)!.config.enabled).toBe(true);
  });

  it('rejects a wrong step count, a foreign template, a code on a flow without offer, a delayed back-in-stock', () => {
    const cart = FLOW_DEFS.abandoned_cart.defaults;
    expect(() => parseFlowSettings('abandoned_cart', { ...cart, steps: cart.steps.slice(0, 2) })).toThrow();
    expect(() => parseFlowSettings('abandoned_cart', { ...cart, steps: [{ ...cart.steps[0]!, templateKey: 'order.confirmed' }, cart.steps[1], cart.steps[2]] })).toThrow();
    expect(() => parseFlowSettings('order_updates', { ...FLOW_DEFS.order_updates.defaults, discountRuleId: '0192a000-0000-7000-8000-000000000009' })).toThrow();
    const bis = FLOW_DEFS.back_in_stock.defaults;
    expect(() => parseFlowSettings('back_in_stock', { ...bis, steps: [{ ...bis.steps[0]!, delayMinutes: 60 }] })).toThrow();
    expect(() => parseFlowSettings('abandoned_cart', { ...cart, quietHours: ['9-11'] })).toThrow();
  });
});

describe('quiet hours (IST)', () => {
  const windows = ['09:00-11:00', '18:30-21:00'];
  it('moves a time inside a window to its end, leaves others alone', () => {
    expect(shiftOutOfQuietHours(ist('2026-10-20T09:30:00'), windows)).toEqual(ist('2026-10-20T11:00:00'));
    expect(shiftOutOfQuietHours(ist('2026-10-20T19:00:00'), windows)).toEqual(ist('2026-10-20T21:00:00'));
    expect(shiftOutOfQuietHours(ist('2026-10-20T11:00:00'), windows)).toEqual(ist('2026-10-20T11:00:00'));
    expect(shiftOutOfQuietHours(ist('2026-10-20T08:59:00'), windows)).toEqual(ist('2026-10-20T08:59:00'));
  });
  it('handles windows across midnight and chains touching windows', () => {
    expect(shiftOutOfQuietHours(ist('2026-10-20T23:15:00'), ['21:00-09:00'])).toEqual(ist('2026-10-21T09:00:00'));
    expect(shiftOutOfQuietHours(ist('2026-10-20T19:00:00'), ['18:30-21:00', '21:00-09:00'])).toEqual(ist('2026-10-21T09:00:00'));
    expect(shiftOutOfQuietHours(ist('2026-10-20T19:00:00'), ['00:00-12:00', '12:00-00:00'])).toEqual(ist('2026-10-20T19:00:00'));
  });
  it('dueAt adds the delay to the start, then shifts', () => {
    expect(dueAt(ist('2026-10-20T08:30:00'), 60, windows)).toEqual(ist('2026-10-20T11:00:00'));
    expect(dueAt(ist('2026-10-20T08:30:00'), 1440, windows)).toEqual(ist('2026-10-21T08:30:00'));
    expect(dueAt(ist('2026-10-20T08:30:00'), 60, [])).toEqual(ist('2026-10-20T09:30:00'));
  });
});
