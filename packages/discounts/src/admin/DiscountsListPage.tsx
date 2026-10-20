import Link from 'next/link';
import { requirePermission } from '@ecomkit/core/auth-context';
import type { Paise } from '@ecomkit/core/contracts';
import { formatINR } from '@ecomkit/core/money';
import { Badge, buttonVariants, EmptyState, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { toIstLocal, windowState, type DiscountRule } from '../domain';
import { listRules } from '../server/discounts';

const describeValue = (r: Pick<DiscountRule, 'valueType' | 'value'>) => (r.valueType === 'percent' ? `${r.value}% off` : `${formatINR(r.value as Paise)} off`);
const when = (d: Date | null) => (d ? toIstLocal(d).replace('T', ' ') : 'open');
const STATE_LABEL = { live: 'Live', inactive: 'Off', not_started: 'Scheduled', ended: 'Ended' } as const;

/** /admin/discounts */
export async function DiscountsListPage({ now: nowOverride }: { now?: Date } = {}) {
  await requirePermission('marketing.write');
  // The clock is read only after the request-time marker above (cache components refuse `new Date()` in a prerender).
  const now = nowOverride ?? new Date();
  const rules = await listRules();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <Link href="/admin/discounts/new" className={buttonVariants({ size: 'sm' })} data-cta="discounts-new">
          New discount
        </Link>
      </div>
      {rules.length === 0 ? (
        <EmptyState title="No discounts yet" body="Create an automatic promotion or a coupon code." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Value</Th>
              <Th>Window (IST)</Th>
              <Th>State</Th>
              <Th>Uses</Th>
            </Tr>
          </THead>
          <TBody>
            {rules.map((r) => {
              const state = windowState(r, now);
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/admin/discounts/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                  </Td>
                  <Td>{r.kind === 'code' ? `Code (${r.codes})` : 'Automatic'}</Td>
                  <Td>{describeValue(r)}</Td>
                  <Td className="whitespace-nowrap">
                    {when(r.startsAt)} to {when(r.endsAt)}
                  </Td>
                  <Td>
                    <Badge>{state === 'inactive' ? r.status : STATE_LABEL[state]}</Badge>
                  </Td>
                  <Td>
                    {r.uses}
                    {r.usageLimitTotal ? ` / ${r.usageLimitTotal}` : ''}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
