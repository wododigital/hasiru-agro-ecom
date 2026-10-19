import { SettingsPage } from '@ecomkit/admin-shell/admin';
import type { FormState } from '@ecomkit/admin-shell/domain';
import { runSettingsAction, saveSettings } from '@ecomkit/admin-shell/server';
import type { Metadata } from 'next';
// eslint-disable-next-line no-restricted-imports
import { registry } from '../../../../../src/generated/registry';

export const metadata: Metadata = { title: 'Settings' };

async function save(moduleId: string, _prev: FormState, form: FormData) {
  'use server';
  return saveSettings(registry, moduleId, form);
}

async function run(moduleId: string, actionId: string) {
  'use server';
  return runSettingsAction(registry, moduleId, actionId);
}

// Every module's settings page is rendered from its manifest; no module owns a route under /admin/settings.
export default function Page({ params }: { params: Promise<{ module: string }> }) {
  return <SettingsPage registry={registry} params={params} save={save} runAction={run} />;
}
