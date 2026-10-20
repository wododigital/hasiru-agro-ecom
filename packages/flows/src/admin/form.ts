import { FLOW_DEFS, type FlowKey } from '../domain';

export const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

/** Form fields to the settings object; parseFlowSettings (in saveFlow) does the real validation. */
export function formToSettings(form: FormData, key: FlowKey): { status: 'active' | 'paused'; settings: unknown } {
  const num = (name: string) => Number(text(form, name));
  return {
    status: form.get('enabled') ? 'active' : 'paused',
    settings: {
      steps: FLOW_DEFS[key].templates.map((_, i) => ({
        enabled: !!form.get(`step${i}_enabled`),
        templateKey: text(form, `step${i}_template`),
        channel: text(form, `step${i}_channel`),
        delayMinutes: Math.round(num(`step${i}_delay_hours`) * 60),
      })),
      quietHours: text(form, 'quietHours')
        .split(/[\s,]+/)
        .filter(Boolean),
      maxPer7Days: num('maxPer7Days'),
      discountRuleId: text(form, 'discountRuleId') || null,
      codeValidHours: num('codeValidHours') || 48,
    },
  };
}

