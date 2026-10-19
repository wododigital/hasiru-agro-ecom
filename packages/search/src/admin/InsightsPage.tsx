import { requirePermission } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { EmptyState, TBody, THead, Table, Td, Th, Tr } from '@ecomkit/ui';
import { queryStats, zeroFilterStats, type QueryStat } from '../server/log';

const DAYS = 30;
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

function QueryTable({ rows, empty }: { rows: QueryStat[]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <Table>
      <THead>
        <tr>
          <Th>Query</Th>
          <Th className="text-right">Searches</Th>
          <Th className="text-right">Last results</Th>
          <Th>Last searched</Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.q}>
            <Td className="font-medium">{r.q}</Td>
            <Td className="text-right tabular-nums">{r.searches}</Td>
            <Td className="text-right tabular-nums">{r.lastResults}</Td>
            <Td>{dateFmt.format(r.lastAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** /admin/search: what visitors search for, what finds nothing, and filter combinations that end empty. */
export async function InsightsPage() {
  await requirePermission('analytics.read');
  const [top, zero, filters] = await Promise.all([queryStats(db, { days: DAYS }), queryStats(db, { days: DAYS, zeroOnly: true }), zeroFilterStats(db, { days: DAYS })]);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold">Search insights</h1>
        <p className="text-sm text-muted">Last {DAYS} days. Queries are stored normalised, without personal data.</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Searches that found nothing</h2>
        <p className="text-sm text-muted">Add the term as an alias on the matching product, or stock what people ask for.</p>
        <QueryTable rows={zero} empty="No zero-result searches yet." />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Top searches</h2>
        <QueryTable rows={top} empty="No searches yet." />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Filter combinations with no results</h2>
        {filters.length ? (
          <Table>
            <THead>
              <tr>
                <Th>Filters</Th>
                <Th className="text-right">Times</Th>
              </tr>
            </THead>
            <TBody>
              {filters.map((f) => (
                <Tr key={f.filters}>
                  <Td className="font-mono text-xs">{f.filters}</Td>
                  <Td className="text-right tabular-nums">{f.times}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No empty filter combinations yet." />
        )}
      </section>
    </div>
  );
}
