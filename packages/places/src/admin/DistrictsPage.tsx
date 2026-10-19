import Link from 'next/link';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { requirePermission } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { Badge, Button, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@ecomkit/ui';
import { MIN_FITTING_PLANTS, countFitting } from '../domain';
import { placesMessages } from '../messages';
import { placesDistrict, placesState } from '../schema';
import { getSnapshot } from '../server/cache';
import { loadDistrictPlants } from '../server/plant-source';
import { createPlacesReader } from '../server/reader';
import { introForm, togglePageForm } from './actions';

const PAGE_SIZE = 50;

/** Admin > Places: which districts have a public /grow-in page. Karnataka first. */
export default async function DistrictsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('content.write');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const state = /^[A-Z]{2}$/.test(one(sp.state)) ? one(sp.state) : '';
  const q = one(sp.q).slice(0, 60);
  const enabledOnly = one(sp.enabled) === '1';
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);

  const where = and(
    state ? eq(placesDistrict.stateCode, state) : undefined,
    q ? or(ilike(placesDistrict.name, `%${q}%`), ilike(placesDistrict.slug, `%${q}%`)) : undefined,
    enabledOnly ? eq(placesDistrict.pageEnabled, true) : undefined,
  );
  const [rows, [{ n } = { n: 0 }], states, plants, snap] = await Promise.all([
    db
      .select()
      .from(placesDistrict)
      .where(where)
      .orderBy(desc(sql`${placesDistrict.stateCode} = 'KA'`), asc(placesDistrict.stateCode), asc(placesDistrict.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(placesDistrict).where(where),
    db.select().from(placesState).orderBy(placesState.name),
    loadDistrictPlants(),
    getSnapshot(),
  ]);
  const reader = createPlacesReader(async () => snap);
  const fitCounts = new Map<string, number>();
  if (plants) {
    for (const r of rows) {
      const fits = await Promise.all(plants.map((p) => reader.fitScored(r.slug, p.climate)));
      fitCounts.set(r.slug, countFitting(fits.filter((f): f is NonNullable<typeof f> => f !== null)));
    }
  }
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const link = (p: number) => `/admin/places?${new URLSearchParams({ ...(state && { state }), ...(q && { q }), ...(enabledOnly && { enabled: '1' }), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{placesMessages.admin.title}</h1>
      <p className="text-sm text-muted">{placesMessages.admin.help}</p>
      <form className="flex flex-wrap gap-2" action="/admin/places">
        <Input name="q" defaultValue={q} placeholder="Search district" className="max-w-xs" aria-label="Search district" />
        <Select name="state" defaultValue={state} className="max-w-48" aria-label="State">
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" value="1" defaultChecked={enabledOnly} />
          Enabled only
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Table>
        <THead>
          <Tr>
            <Th>District</Th>
            <Th>State</Th>
            <Th>Distance</Th>
            <Th>Fitting plants</Th>
            <Th>Page</Th>
            <Th>Intro</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const fitting = fitCounts.get(r.slug);
            return (
              <Tr key={r.slug}>
                <Td>
                  <div className="font-medium">{r.name}</div>
                  {r.reviewNotes.length ? <div className="text-xs text-muted">{r.reviewNotes[0]}</div> : null}
                </Td>
                <Td>{r.stateCode}</Td>
                <Td>{r.distanceKmFromNursery === null ? 'n/a' : `${Math.round(r.distanceKmFromNursery)} km`}</Td>
                <Td>
                  {fitting === undefined ? 'n/a' : fitting}
                  {fitting !== undefined && fitting < MIN_FITTING_PLANTS ? <Badge tone="warning" className="ml-2">Under {MIN_FITTING_PLANTS}</Badge> : null}
                </Td>
                <Td>
                  <form action={togglePageForm} className="flex items-center gap-2">
                    <input type="hidden" name="slug" value={r.slug} />
                    <input type="hidden" name="enabled" value={String(!r.pageEnabled)} />
                    <Badge tone={r.pageEnabled ? 'success' : 'neutral'}>{r.pageEnabled ? 'Enabled' : 'Off'}</Badge>
                    <Button type="submit" size="sm" variant="outline">
                      {r.pageEnabled ? 'Turn off' : 'Turn on'}
                    </Button>
                    {r.pageEnabled ? (
                      <Link href={`/grow-in/${r.slug}`} className="text-sm underline" target="_blank">
                        View
                      </Link>
                    ) : null}
                  </form>
                </Td>
                <Td>
                  <form action={introForm} className="flex gap-2">
                    <input type="hidden" name="slug" value={r.slug} />
                    <Input name="html" defaultValue={r.pageIntroHtml ?? ''} maxLength={4000} aria-label={`Intro for ${r.name}`} className="min-w-56" />
                    <Button type="submit" size="sm" variant="subtle">
                      Save
                    </Button>
                  </form>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <nav className="flex items-center gap-3 text-sm" aria-label="Pages">
        {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : null}
        <span>
          Page {page} of {pages} ({n} districts)
        </span>
        {page < pages ? <Link href={link(page + 1)}>Next</Link> : null}
      </nav>
    </div>
  );
}
