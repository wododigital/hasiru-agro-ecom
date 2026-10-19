import { Badge, Stat } from '@ecomkit/ui';
import Link from 'next/link';
import type { LevelView } from '../server';
import { formatIst, SOURCE_LABEL, STATE_LABEL } from './format';
import { LevelFormsIsland } from './LevelFormsIsland';

export function SourceBadge({ source }: { source: LevelView['source'] }) {
  return source === 'manual' ? (
    <Badge tone="warning" title="Manual counts win over ERP pulls until the override is cleared">
      Manual wins
    </Badge>
  ) : (
    <Badge tone="outline">{SOURCE_LABEL[source]}</Badge>
  );
}

export function StateBadge({ level }: { level: Pick<LevelView, 'availability' | 'lowStock'> }) {
  if (level.availability === 'in_stock') return <Badge tone={level.lowStock ? 'warning' : 'success'}>{level.lowStock ? 'Low stock' : STATE_LABEL.in_stock}</Badge>;
  return <Badge tone={level.availability === 'preorder' ? 'neutral' : 'danger'}>{STATE_LABEL[level.availability]}</Badge>;
}

/** One variant's numbers and its forms. */
export function LevelCard({ level, showLink = false }: { level: LevelView; showLink?: boolean }) {
  const drift = level.erpOnHand != null && level.erpOnHand !== level.onHand;
  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-text">{level.sku ?? level.variantId}</h3>
        <StateBadge level={level} />
        <SourceBadge source={level.source} />
        {showLink ? (
          <Link href={`/admin/inventory/${level.variantId}`} className="ml-auto text-sm text-primary underline-offset-4 hover:underline">
            Movements
          </Link>
        ) : null}
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="On hand" value={level.onHand} />
        <Stat label="Reserved" value={level.reserved} />
        <Stat label="Sellable" value={level.available} />
        <Stat label="ERP reports" value={level.erpOnHand ?? '-'} delta={drift ? `Differs by ${level.onHand - level.erpOnHand!}` : level.erpUpdatedAt ? formatIst(level.erpUpdatedAt) : undefined} trend={drift ? 'down' : 'flat'} />
      </div>
      <LevelFormsIsland
        variantId={level.variantId}
        productId={level.productId}
        onHand={level.onHand}
        lowStockThreshold={level.lowStockThreshold}
        readyInDays={level.readyInDays}
        manual={level.source === 'manual'}
      />
    </section>
  );
}
