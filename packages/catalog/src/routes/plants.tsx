import { topCollections } from '../server/queries';
import { catalogRuntime } from '../server/runtime';
import { ListingPage } from '../ui/ListingPage';
import { listingMetadata, type SP } from './shared';

export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const m = catalogRuntime().messages;
  return listingMetadata(m.listing.allPlants, m.listing.plantsIntro, '/plants', searchParams);
}

/** /plants: every plant, with collection tabs and live counts. */
export default async function PlantsPage({ searchParams }: { searchParams: SP }) {
  const m = catalogRuntime().messages;
  const tops = await topCollections('plant');
  return (
    <ListingPage
      title={m.listing.allPlants}
      intro={m.listing.plantsIntro}
      path="/plants"
      breadcrumbs={[{ label: m.nav.home, href: '/' }, { label: m.nav.plants }]}
      filter={{ kind: 'plant' }}
      tabs={tops.map((t) => ({ href: `/plants/${t.slug}`, label: t.name, count: t.count, active: false }))}
      searchParams={searchParams}
    />
  );
}
