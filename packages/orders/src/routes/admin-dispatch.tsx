import type { Metadata } from 'next';
import { DispatchPage } from '../admin';

export function generateMetadata(): Metadata {
  return { title: 'Dispatch planner' };
}

export default function AdminDispatchRoute() {
  return <DispatchPage />;
}
