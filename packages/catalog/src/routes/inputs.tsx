import { catalogRuntime } from '../server/runtime';
import { ListingPage } from '../ui/ListingPage';
import { listingMetadata, type SP } from './shared';

export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const m = catalogRuntime().messages;
  return listingMetadata(m.listing.allInputs, m.listing.inputsIntro, '/inputs', searchParams);
}

/** /inputs: compost, biochar, seeds and other inputs. */
export default function InputsPage({ searchParams }: { searchParams: SP }) {
  const m = catalogRuntime().messages;
  return (
    <ListingPage
      title={m.listing.allInputs}
      intro={m.listing.inputsIntro}
      path="/inputs"
      breadcrumbs={[{ label: m.nav.home, href: '/' }, { label: m.nav.inputs }]}
      filter={{ kind: 'input' }}
      searchParams={searchParams}
    />
  );
}
