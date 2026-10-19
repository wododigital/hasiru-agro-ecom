import { Breadcrumbs, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { notFound } from 'next/navigation';
import { getLevel, listMovements } from '../server';
import { formatIst, REASON_LABEL } from './format';
import { LevelCard } from './LevelCard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /admin/inventory/[variantId]: the level, its forms and the movements ledger (newest first). */
export async function InventoryDetailPage({ variantId }: { variantId: string }) {
  if (!UUID_RE.test(variantId)) notFound();
  const [level, movements] = await Promise.all([getLevel(variantId), listMovements(variantId, 100)]);
  if (!level) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: 'Inventory', href: '/admin/inventory' }, { label: level.sku ?? level.variantId }]} />
      <LevelCard level={level} />
      <h2 className="text-lg font-semibold text-text">Movements</h2>
      <Table>
        <THead>
          <tr>
            <Th>When</Th>
            <Th>Reason</Th>
            <Th className="text-right">Change</Th>
            <Th>Reference</Th>
          </tr>
        </THead>
        <TBody>
          {movements.map((m) => (
            <Tr key={m.id}>
              <Td>{formatIst(m.createdAt)}</Td>
              <Td>{REASON_LABEL[m.reason]}</Td>
              <Td className="text-right tabular-nums">{m.delta > 0 ? `+${m.delta}` : m.delta}</Td>
              <Td className="text-muted">{m.ref ?? ''}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
