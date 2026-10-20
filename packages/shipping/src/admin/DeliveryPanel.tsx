import { asc } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { requirePermission } from '@ecomkit/core/auth-context';
import { db } from '@ecomkit/core/db';
import { Button, Input, Select } from '@ecomkit/ui';
import { METHOD_KINDS, PACKING_SCOPES, ZONE_KINDS } from '../domain';
import { shippingDistanceOverride, shippingMethod, shippingPackingRule, shippingSlot, shippingVehicle, shippingZone } from '../schema';
import { deleteRowForm, saveDistanceForm, saveMethodForm, savePackingRuleForm, saveSlotForm, saveVehicleForm, saveZoneForm } from './actions';

// Settings > Delivery custom panel: zones, methods, vehicles, slot calendar, packing rules and distance overrides.
// Plain forms posting to server actions: works without client JS, one row per form.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rs = (p: number) => String(p / 100);

function Section({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs text-muted">{help}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ action, children, del }: { action: (f: FormData) => Promise<void>; children: ReactNode; del?: { table: string; id: string } }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
      <form action={action} className="flex flex-1 flex-wrap items-end gap-2">
        {children}
        <Button type="submit" size="sm" variant="outline">
          Save
        </Button>
      </form>
      {del ? (
        <form action={deleteRowForm}>
          <input type="hidden" name="table" value={del.table} />
          <input type="hidden" name="id" value={del.id} />
          <Button type="submit" size="sm" variant="ghost">
            Delete
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

function Options({ values, labels }: { values: readonly (string | number)[]; labels?: readonly string[] }) {
  return values.map((v, i) => (
    <option key={String(v)} value={String(v)}>
      {labels?.[i] ?? String(v)}
    </option>
  ));
}

export async function DeliveryPanel() {
  await requirePermission('settings.read');
  const [zones, methods, vehicles, slots, rules, distances] = await Promise.all([
    db.select().from(shippingZone).orderBy(asc(shippingZone.position)),
    db.select().from(shippingMethod).orderBy(asc(shippingMethod.position)),
    db.select().from(shippingVehicle).orderBy(asc(shippingVehicle.capacityKg)),
    db.select().from(shippingSlot).orderBy(asc(shippingSlot.weekday)),
    db.select().from(shippingPackingRule).orderBy(asc(shippingPackingRule.position)),
    db.select().from(shippingDistanceOverride).orderBy(asc(shippingDistanceOverride.districtSlug)),
  ]);

  const zoneFields = (z?: (typeof zones)[number]) => (
    <>
      {z ? <input type="hidden" name="id" value={z.id} /> : null}
      <Field label="Slug">
        <Input name="slug" defaultValue={z?.slug ?? ''} required className="w-32" />
      </Field>
      <Field label="Name">
        <Input name="name" defaultValue={z?.name ?? ''} required className="w-40" />
      </Field>
      <Field label="Kind">
        <Select name="kind" defaultValue={z?.kind ?? 'outstation'}>
          <Options values={ZONE_KINDS} />
        </Select>
      </Field>
      <Field label="District slugs">
        <Input name="district_slugs" defaultValue={z?.districtSlugs.join(', ') ?? ''} className="w-64" />
      </Field>
      <Field label="State codes">
        <Input name="state_codes" defaultValue={z?.stateCodes.join(', ') ?? ''} className="w-40" />
      </Field>
      <Field label="Position">
        <Input name="position" type="number" defaultValue={z?.position ?? 0} className="w-20" />
      </Field>
    </>
  );

  const methodFields = (m?: (typeof methods)[number]) => (
    <>
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <Field label="Name">
        <Input name="name" defaultValue={m?.name ?? ''} required className="w-44" />
      </Field>
      <Field label="Kind">
        <Select name="kind" defaultValue={m?.kind ?? 'local_slot'}>
          <Options values={METHOD_KINDS} />
        </Select>
      </Field>
      <Field label="Zone">
        <Select name="zone_id" defaultValue={m?.zoneId ?? ''}>
          <option value="">Any zone of this kind</option>
          <Options values={zones.map((z) => z.id)} labels={zones.map((z) => z.name)} />
        </Select>
      </Field>
      <Field label="Rules (JSON)">
        <Input name="rules" defaultValue={JSON.stringify(m?.rules ?? {})} className="w-64 font-mono" />
      </Field>
      <Field label="Position">
        <Input name="position" type="number" defaultValue={m?.position ?? 0} className="w-20" />
      </Field>
      <Field label="Active">
        <input type="checkbox" name="is_active" defaultChecked={m?.isActive ?? true} />
      </Field>
    </>
  );

  const vehicleFields = (v?: (typeof vehicles)[number]) => (
    <>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <Field label="Name">
        <Input name="name" defaultValue={v?.name ?? ''} required className="w-40" />
      </Field>
      <Field label="Capacity (kg)">
        <Input name="capacity_kg" type="number" min={1} defaultValue={v?.capacityKg ?? ''} required className="w-28" />
      </Field>
      <Field label="Local flat (Rs per trip)">
        <Input name="local_flat_rs" type="number" min={0} step="0.01" defaultValue={v ? rs(v.localFlatPaise) : ''} required className="w-32" />
      </Field>
      <Field label="Outstation (Rs per km)">
        <Input name="per_km_rs" type="number" min={0} step="0.01" defaultValue={v ? rs(v.perKmPaise) : ''} required className="w-32" />
      </Field>
      <Field label="Active">
        <input type="checkbox" name="is_active" defaultChecked={v?.isActive ?? true} />
      </Field>
    </>
  );

  const slotFields = (s?: (typeof slots)[number]) => (
    <>
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <Field label="Day">
        <Select name="weekday" defaultValue={String(s?.weekday ?? 6)}>
          <Options values={[0, 1, 2, 3, 4, 5, 6]} labels={WEEKDAYS} />
        </Select>
      </Field>
      <Field label="Cutoff (hours before the day starts, IST)">
        <Input name="cutoff_hours" type="number" min={0} defaultValue={s?.cutoffHours ?? 24} className="w-24" />
      </Field>
      <Field label="Capacity (kg, blank = no cap)">
        <Input name="capacity_kg" type="number" min={1} defaultValue={s?.capacityKg ?? ''} className="w-28" />
      </Field>
      <Field label="Active">
        <input type="checkbox" name="is_active" defaultChecked={s?.isActive ?? true} />
      </Field>
    </>
  );

  const ruleFields = (r?: (typeof rules)[number]) => (
    <>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Field label="Scope">
        <Select name="scope" defaultValue={r?.scope ?? 'size_class'}>
          <Options values={PACKING_SCOPES} />
        </Select>
      </Field>
      <Field label="Match (JSON)">
        <Input name="match" defaultValue={JSON.stringify(r?.match ?? {})} className="w-72 font-mono" />
      </Field>
      <Field label="Fee (Rs; per unit, per order for scope order)">
        <Input name="fee_rs" type="number" min={0} step="0.01" defaultValue={r ? rs(r.feePaise) : ''} required className="w-28" />
      </Field>
      <Field label="Position">
        <Input name="position" type="number" defaultValue={r?.position ?? 0} className="w-20" />
      </Field>
    </>
  );

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-4 text-sm">
      <Section
        title="Zones"
        help="Where each address belongs. A district listed on a zone beats a state listed on another zone. Addresses in no zone get delivery on request only."
      >
        {zones.map((z) => (
          <Row key={z.id} action={saveZoneForm} del={{ table: 'zone', id: z.id }}>
            {zoneFields(z)}
          </Row>
        ))}
        <Row action={saveZoneForm}>{zoneFields()}</Row>
      </Section>

      <Section
        title="Methods"
        help='Pickup rules: {"readyInDays":1}. Local slot: {"slotsShown":4}. Outstation: {"minDays":5,"maxDays":7}. Deleting a zone deletes the methods attached to it.'
      >
        {methods.map((m) => (
          <Row key={m.id} action={saveMethodForm} del={{ table: 'method', id: m.id }}>
            {methodFields(m)}
          </Row>
        ))}
        <Row action={saveMethodForm}>{methodFields()}</Row>
      </Section>

      <Section title="Vehicles" help="The smallest vehicle that carries the order is used; heavier orders take more trips of the largest. Local charge = flat x trips; outstation = km x rate x trips.">
        {vehicles.map((v) => (
          <Row key={v.id} action={saveVehicleForm} del={{ table: 'vehicle', id: v.id }}>
            {vehicleFields(v)}
          </Row>
        ))}
        <Row action={saveVehicleForm}>{vehicleFields()}</Row>
      </Section>

      <Section title="Local delivery days" help="Weekly delivery days for local slot delivery. Holidays go in the blackout dates above.">
        {slots.map((s) => (
          <Row key={s.id} action={saveSlotForm} del={{ table: 'slot', id: s.id }}>
            {slotFields(s)}
          </Row>
        ))}
        <Row action={saveSlotForm}>{slotFields()}</Row>
      </Section>

      <Section
        title="Packing rules"
        help='Per line, the first matching rule sets the fee per unit; otherwise the product&apos;s own packing fee applies. Match: product {"productIds":[],"variantIds":[]}, size_class {"sizeClass":"L"}, qty_band {"minQty":100,"maxQty":null}, order {} (a flat fee once per order).'
      >
        {rules.map((r) => (
          <Row key={r.id} action={savePackingRuleForm} del={{ table: 'packing_rule', id: r.id }}>
            {ruleFields(r)}
          </Row>
        ))}
        <Row action={savePackingRuleForm}>{ruleFields()}</Row>
      </Section>

      <Section title="Distance overrides" help="Road distance from the store in km for a district, used for outstation charges instead of the estimate.">
        {distances.map((d) => (
          <Row key={d.districtSlug} action={saveDistanceForm} del={{ table: 'distance', id: d.districtSlug }}>
            <Field label="District slug">
              <Input name="district_slug" defaultValue={d.districtSlug} readOnly className="w-40" />
            </Field>
            <Field label="km">
              <Input name="km" type="number" min={0} step="0.1" defaultValue={d.km} className="w-24" />
            </Field>
            <Field label="Note">
              <Input name="note" defaultValue={d.note ?? ''} className="w-56" />
            </Field>
          </Row>
        ))}
        <Row action={saveDistanceForm}>
          <Field label="District slug">
            <Input name="district_slug" required className="w-40" />
          </Field>
          <Field label="km">
            <Input name="km" type="number" min={0} step="0.1" required className="w-24" />
          </Field>
          <Field label="Note">
            <Input name="note" className="w-56" />
          </Field>
        </Row>
      </Section>
    </div>
  );
}
