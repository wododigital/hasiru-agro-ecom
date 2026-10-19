import { notFound } from 'next/navigation';
import { requirePermission } from '@ecomkit/core/auth-context';
import { TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { toIstLocal } from '../domain';
import { getRule } from '../server/discounts';
import { CodesFormIsland } from './CodesFormIsland';
import { RuleFormIsland, type RuleFormDefaults } from './RuleFormIsland';

const str = (n: number | null) => (n === null ? '' : String(n));
const rupees = (p: number | null) => (p === null ? '' : String(p / 100));

const BLANK: RuleFormDefaults = {
  id: null, name: '', kind: 'automatic', status: 'draft', startsAt: '', endsAt: '', valueType: 'percent', value: '', appliesTo: 'order', targetIds: '',
  minQty: '', minSubtotal: '', customerEligibility: 'all', segmentId: '', usageLimitTotal: '', usageLimitPerCustomer: '', stackable: false, priority: '0', descriptionPublic: '',
};

/** /admin/discounts/new (id null) and /admin/discounts/[id]. */
export async function DiscountEditPage({ id }: { id: string | null }) {
  await requirePermission('marketing.write');
  const detail = id ? await getRule(id) : null;
  if (id && !detail) notFound();
  const r = detail?.rule;
  const defaults: RuleFormDefaults = r
    ? {
        id: r.id, name: r.name, kind: r.kind, status: r.status, startsAt: toIstLocal(r.startsAt), endsAt: toIstLocal(r.endsAt), valueType: r.valueType,
        value: r.valueType === 'fixed' ? rupees(r.value) : String(r.value), appliesTo: r.appliesTo, targetIds: r.targetIds.join('\n'), minQty: str(r.minQty),
        minSubtotal: rupees(r.minSubtotalPaise), customerEligibility: r.customerEligibility, segmentId: r.segmentId ?? '', usageLimitTotal: str(r.usageLimitTotal),
        usageLimitPerCustomer: str(r.usageLimitPerCustomer), stackable: r.stackable, priority: String(r.priority), descriptionPublic: r.descriptionPublic ?? '',
      }
    : BLANK;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{r ? r.name : 'New discount'}</h1>
      <RuleFormIsland defaults={defaults} />
      {r?.kind === 'code' && detail ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Codes</h2>
          <CodesFormIsland ruleId={r.id} />
          {detail.codes.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Code</Th>
                  <Th>Personal</Th>
                  <Th>Expires (IST)</Th>
                  <Th>Uses</Th>
                </Tr>
              </THead>
              <TBody>
                {detail.codes.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-mono">{c.code}</Td>
                    <Td>{c.singleUse ? 'Yes, one use' : 'No'}</Td>
                    <Td>{c.expiresAt ? toIstLocal(c.expiresAt).replace('T', ' ') : ''}</Td>
                    <Td>{c.uses}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
