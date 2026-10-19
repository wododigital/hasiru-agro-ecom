import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { monitoringSettingsSchema, type MonitoringSettings } from '../domain';

export const monitoringSettingsDef = defineSettings('monitoring', monitoringSettingsSchema);

/** Stored settings, or the defaults when they cannot be read (checks must still run when the database is down). */
export async function monitoringSettings(): Promise<MonitoringSettings> {
  try {
    return await getSettings(monitoringSettingsDef);
  } catch {
    return monitoringSettingsSchema.parse({});
  }
}
