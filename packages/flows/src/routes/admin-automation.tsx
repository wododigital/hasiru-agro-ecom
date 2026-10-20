import type { Metadata } from 'next';
import { FLOW_DEFS, isFlowKey } from '../domain';
import { FlowPage } from '../admin/pages';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: isFlowKey(key) ? FLOW_DEFS[key].name : 'Automation' };
}

export default function AdminAutomationRoute(props: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <FlowPage {...props} />;
}
