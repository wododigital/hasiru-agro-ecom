import { defineSettings, getSettings } from '@ecomkit/core/settings';
import { erpSyncSettingsSchema, type ErpSyncSettings } from '../domain';

export const erpSyncSettings = defineSettings('erp-sync', erpSyncSettingsSchema);
export const loadSettings = (): Promise<ErpSyncSettings> => getSettings(erpSyncSettings);
