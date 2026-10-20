import type { Metadata } from 'next';
import { AutomationsPage } from '../admin/pages';

export function generateMetadata(): Metadata {
  return { title: 'Automations' };
}

export default function AdminAutomationsRoute() {
  return <AutomationsPage />;
}
