'use client';

import { paise } from '@ecomkit/core/money';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { DateRange } from '../ui/DateRange';
import { Dialog, DialogContent, DialogTrigger, Sheet, SheetContent, SheetTrigger } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/Input';
import { Price } from '../ui/Price';
import { QtyStepper } from '../ui/QtyStepper';
import { SecretField } from '../ui/SecretField';
import { Segmented } from '../ui/Segmented';
import { StickyBar } from '../ui/StickyBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { ToastRegion, toast } from '../ui/Toast';

/** Stateful demos for the stories page (admin surface, so copy is inline). */
export function StoriesIsland({ section }: { section: 'qty' | 'overlays' | 'forms' | 'tabs' }) {
  const [card, setCard] = useState(0);
  const [cart, setCart] = useState(96);
  const [unit, setUnit] = useState('acre');
  const [range, setRange] = useState({ from: '2026-10-01', to: '2026-10-20' });
  const [stickyOn, setStickyOn] = useState(false);

  if (section === 'qty') {
    return (
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">Card: Add becomes the stepper</p>
          <QtyStepper value={card} onChange={setCard} itemName="Alphonso mango" cta="stories-card-add" />
          <output className="text-xs text-muted" data-testid="card-qty">
            qty {card}
          </output>
        </div>
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">Cart line (light, +10 / +50 chips, step 10 from 100)</p>
          <QtyStepper value={cart} onChange={setCart} tone="light" addButton={false} itemName="Teak" />
          <output className="text-xs text-muted" data-testid="cart-qty">
            qty {cart}
          </output>
        </div>
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">Disabled</p>
          <QtyStepper value={3} onChange={() => {}} disabled itemName="Sandalwood" />
        </div>
      </div>
    );
  }

  if (section === 'overlays') {
    return (
      <div className="flex flex-wrap gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent title="Plant calculator" description="Esc, the backdrop and the close button all dismiss." side="sheet">
            <p>Bottom sheet on phones, centred from md up.</p>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open menu drawer</Button>
          </SheetTrigger>
          <SheetContent side="left" title="Menu">
            <nav className="flex flex-col gap-3">
              <a href="#buttons">Plants</a>
              <a href="#buttons">Help me choose</a>
            </nav>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open cart drawer</Button>
          </SheetTrigger>
          <SheetContent title="Your cart">
            <p className="text-sm text-muted">Drawer from the right.</p>
          </SheetContent>
        </Sheet>
        <Button variant="accent" onClick={() => toast('Added 10 Alphonso mango', { action: { label: 'View cart', onClick: () => {} } })}>
          Show toast
        </Button>
        <Button variant="subtle" onClick={() => setStickyOn((v) => !v)} aria-pressed={stickyOn}>
          Toggle sticky bar
        </Button>
        {stickyOn ? (
          <StickyBar mobileOnly={false}>
            <span className="text-sm">
              12 items · <Price paise={paise(5940)} size="sm" />
            </span>
            <Button size="sm" variant="accent">
              View cart
            </Button>
          </StickyBar>
        ) : null}
        <ToastRegion label="Notifications" />
      </div>
    );
  }

  if (section === 'tabs') {
    return (
      <Tabs defaultValue="fruiting">
        <TabsList aria-label="Category">
          <TabsTrigger value="timber" count={18}>
            Timber
          </TabsTrigger>
          <TabsTrigger value="fruiting" count={42}>
            Fruiting
          </TabsTrigger>
          <TabsTrigger value="other" count={27}>
            Other
          </TabsTrigger>
        </TabsList>
        <TabsContent value="timber" className="pt-3 text-sm">
          Timber panel
        </TabsContent>
        <TabsContent value="fruiting" className="pt-3 text-sm">
          Fruiting panel
        </TabsContent>
        <TabsContent value="other" className="pt-3 text-sm">
          Other panel
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="grid max-w-xl gap-4">
      <FormField id="story-name" label="Name" help="As it should appear on the invoice" required>
        {(p) => <Input {...p} name="name" autoComplete="name" />}
      </FormField>
      <FormField id="story-phone" label="Phone" error="Enter a 10 digit mobile number">
        {(p) => <Input {...p} name="phone" inputMode="tel" defaultValue="98450" />}
      </FormField>
      <FormField id="story-key" label="API secret" help="Stored encrypted; only the last 4 are shown">
        {(p) => <SecretField {...p} name="apiSecret" masked="•••• 4f2a" />}
      </FormField>
      <FormField id="story-new-key" label="Webhook secret (unset)">
        {(p) => <SecretField {...p} name="webhookSecret" masked={null} />}
      </FormField>
      <Segmented name="unit" label="Land unit" value={unit} onChange={setUnit} options={[{ value: 'acre', label: 'Acre' }, { value: 'sqft', label: 'Sq ft' }]} />
      <DateRange value={range} onChange={setRange} />
    </div>
  );
}
