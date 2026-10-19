import type { Paise } from '@ecomkit/core/contracts';
import { Price, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import type { TierStep } from '../domain/tiers';
import type { CatalogMessages } from '../messages';

/** Bulk price ladder: list price up to the first tier, then one row per tier. */
export function TierTable({ list, tiers, messages, quoteHref }: { list: TierStep; tiers: readonly TierStep[]; messages: CatalogMessages; quoteHref: string | null }) {
  if (!tiers.length) return null;
  const m = messages.pdp;
  return (
    <section aria-labelledby="tiers-title" className="flex flex-col gap-2">
      <h2 id="tiers-title" className="font-display text-lg">
        {m.tiersTitle}
      </h2>
      <Table>
        <THead>
          <Tr>
            <Th scope="col">{m.quantity}</Th>
            <Th scope="col">{m.perUnit}</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>{m.tierBase(tiers[0]!.minQty - 1)}</Td>
            <Td>
              <Price paise={list.unitPaise as Paise} size="sm" />
            </Td>
          </Tr>
          {tiers.map((t) => (
            <Tr key={t.minQty}>
              <Td>{m.tierRow(t.minQty)}</Td>
              <Td>
                <Price paise={t.unitPaise as Paise} size="sm" />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {quoteHref ? (
        <a href={quoteHref} className="text-sm text-primary underline" data-cta="pdp-bulk-quote">
          {m.needMore}
        </a>
      ) : null}
    </section>
  );
}
