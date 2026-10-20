import { paise } from '@ecomkit/core/money';
import { Inbox, Sprout, Sun, Thermometer } from 'lucide-react';
import type { ReactNode } from 'react';
import { parseTableParams } from '../domain/table-params';
import { Badge } from '../ui/Badge';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { Button, buttonVariants } from '../ui/Button';
import { BarChart, Sparkline } from '../ui/Charts';
import { Chip } from '../ui/Chip';
import { DataTable } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { ImageWithFallback } from '../ui/ImageWithFallback';
import { Checkbox, Select, Textarea } from '../ui/Input';
import { Marquee } from '../ui/Marquee';
import { Price } from '../ui/Price';
import { Rail } from '../ui/Rail';
import { Rating } from '../ui/Rating';
import { Skeleton } from '../ui/Skeleton';
import { Stat } from '../ui/Stat';
import { StoriesIsland } from './StoriesIsland';

function Story({ id, title, children, surface }: { id: string; title: string; children: ReactNode; surface?: 'admin' }) {
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 border-t border-border py-6">
      <h2 id={`${id}-h`} className="text-xl">
        {title}
      </h2>
      {surface === 'admin' ? (
        <div data-surface="admin" className="flex min-h-0 flex-col gap-3 rounded-lg p-4">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const orders = [
  { id: 'ORD-2610-00012', customer: 'Sample customer A', district: 'District A', total: paise(18450), status: 'Paid' },
  { id: 'ORD-2610-00011', customer: 'Sample customer B', district: 'District B', total: paise(5940), status: 'Pending' },
  { id: 'ORD-2610-00010', customer: 'Sample customer C', district: 'District C', total: paise(124999), status: 'Dispatched' },
];

const demoImage = {
  id: 'demo',
  src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="darkseagreen"/><circle cx="2" cy="1.5" r=".9" fill="seagreen"/></svg>')}`,
  alt: 'Sample sapling illustration',
  width: 400,
  height: 300,
  blurDataURL: null,
  credit: null,
};

/**
 * Stories for every @ecomkit/ui primitive (admin, dev and test only). The page sets data-surface="shop"
 * so the store theme shows through the admin layout; admin-only primitives sit in a nested admin box.
 */
export function StoriesPage() {
  const params = parseTableParams({}, { sorts: ['id', 'total'], defaultSort: { id: 'id', dir: 'desc' } });
  return (
    <main data-surface="shop" className="mx-auto flex max-w-5xl flex-col bg-bg px-4 py-8 text-base text-text">
      <h1 className="text-3xl">UI primitives</h1>
      <p className="text-muted">@ecomkit/ui stories. Tokens come from tokens.css and the store theme.</p>

      <Story id="buttons" title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="link">Link style</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
          <a href="#qty" className={buttonVariants({ variant: 'accent', size: 'sm' })}>
            Link as button
          </a>
        </div>
      </Story>

      <Story id="badges" title="Badge and Chip">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Bestseller</Badge>
          <Badge tone="accent">Save Rs 50</Badge>
          <Badge tone="success">Bulk unlocked</Badge>
          <Badge tone="warning">Only 4 left</Badge>
          <Badge tone="danger">Out of stock</Badge>
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="outline">New</Badge>
          <Chip icon={<Sprout aria-hidden="true" className="size-3" />}>Large tree</Chip>
          <Chip icon={<Sun aria-hidden="true" className="size-3" />}>Full sun</Chip>
          <Chip icon={<Thermometer aria-hidden="true" className="size-3" />}>18 to 38°</Chip>
        </div>
      </Story>

      <Story id="qty" title="QtyStepper">
        <StoriesIsland section="qty" />
      </Story>

      <Story id="price" title="Price and Rating">
        <div className="flex flex-wrap items-center gap-6">
          <Price paise={paise(249)} />
          <Price paise={paise(199)} compareAtPaise={paise(249)} />
          <Price paise={paise(124999)} size="lg" />
          <Rating average={4.6} count={12} />
          <Rating average={5} count={2} />
          <Rating average={null} count={0} />
        </div>
      </Story>

      <Story id="rail" title="Rail and ImageWithFallback">
        <Rail label="Best sellers">
          {Array.from({ length: 10 }, (_, i) => (
            <a key={i} href="#rail" className="flex flex-col overflow-hidden rounded-md bg-surface shadow-card">
              <ImageWithFallback image={i % 3 === 0 ? null : demoImage} alt="" unoptimized className="aspect-square w-full object-cover" sizes="200px" />
              <span className="p-3 text-sm font-semibold">Sapling {i + 1}</span>
            </a>
          ))}
        </Rail>
      </Story>

      <Story id="marquee" title="Marquee">
        <Marquee className="rounded-md bg-primary-strong py-4 text-primary-fg">
          {['Trust claim one', 'Trust claim two', 'Trust claim three', 'Trust claim four'].map((t) => (
            <span key={t} className="flex items-center gap-3 whitespace-nowrap">
              <i aria-hidden="true" className="size-2 rounded-full bg-accent" />
              {t}
            </span>
          ))}
        </Marquee>
      </Story>

      <Story id="overlays" title="Dialog, Sheet, Toast, StickyBar">
        <StoriesIsland section="overlays" />
      </Story>

      <Story id="tabs" title="Tabs">
        <StoriesIsland section="tabs" />
      </Story>

      <Story id="forms" title="FormField, Input, SecretField, Segmented, DateRange">
        <StoriesIsland section="forms" />
        <div className="grid max-w-xl gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">
            District
            <Select defaultValue="mysuru" name="district">
              <option value="mysuru">Mysuru</option>
              <option value="hassan">Hassan</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-primary">
            Notes
            <Textarea name="notes" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="inStock" defaultChecked />
            In stock only
          </label>
        </div>
      </Story>

      <Story id="data" title="Stat, Sparkline, BarChart (admin palette)" surface="admin">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Orders today" value="18" delta="+12% vs last Monday" trend="up" chart={<Sparkline values={[3, 5, 4, 8, 7, 11, 18]} label="Orders per day, last 7 days, 3 to 18" />} />
          <Stat label="Revenue" value={<Price paise={paise(184500)} />} delta="-4% vs last week" trend="down" />
          <Stat label="Abandoned checkouts" value="6" chart={<BarChart values={[2, 4, 1, 6, 3]} label="Abandoned checkouts per day, 1 to 6" width={160} height={40} />} />
        </div>
      </Story>

      <Story id="table" title="DataTable (admin palette)" surface="admin">
        <DataTable
          basePath="/admin/dev/ui"
          rows={orders}
          params={params}
          total={orders.length}
          pageSize={50}
          rowKey={(r) => r.id}
          filters={[{ key: 'status', label: 'Status', options: [{ value: 'paid', label: 'Paid' }, { value: 'pending', label: 'Pending' }] }]}
          columns={[
            { id: 'id', header: 'Order', cell: (r) => r.id, sortable: true },
            { id: 'customer', header: 'Customer', cell: (r) => r.customer },
            { id: 'district', header: 'District', cell: (r) => r.district },
            { id: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'Paid' ? 'success' : 'neutral'}>{r.status}</Badge> },
            { id: 'total', header: 'Total', cell: (r) => <Price paise={r.total} size="sm" />, sortable: true, align: 'right' },
          ]}
        />
      </Story>

      <Story id="states" title="Breadcrumbs, Skeleton, EmptyState">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Fruiting trees', href: '/plants/fruiting' }, { label: 'Alphonso mango' }]} />
        <div role="status" aria-busy="true" className="flex gap-3">
          <span className="sr-only">Loading example</span>
          <Skeleton className="aspect-square w-32" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <EmptyState icon={<Inbox aria-hidden="true" />} title="No orders yet" body="Orders appear here as soon as a customer pays." action={<Button size="sm">Create manual order</Button>} />
      </Story>
    </main>
  );
}
