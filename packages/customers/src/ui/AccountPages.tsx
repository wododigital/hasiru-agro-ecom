import { Badge, Button, Checkbox, EmptyState, FormField, Input, Select } from '@ecomkit/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CUSTOMER_TYPES } from '../domain';
import { customersMessages, type CustomersMessages } from '../messages';
import type { AddressRow, CustomerRow, LandRow } from '../server';
import { deleteAddressAction, deleteLandAction, saveAddressAction, saveLandAction, saveProfileAction } from './actions';

type Flags = { saved?: string; error?: string; edit?: string };

function Shell({ title, intro, flags, m, children }: { title: string; intro: string; flags: Flags; m: CustomersMessages; children: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl text-primary">{title}</h1>
        <p className="text-muted">{intro}</p>
      </header>
      {flags.saved ? (
        <p role="status" className="rounded-md bg-success/12 px-3 py-2 text-sm text-success">
          {m.common.saved}
        </p>
      ) : null}
      {flags.error ? (
        <p role="alert" className="rounded-md bg-danger/12 px-3 py-2 text-sm text-danger">
          {flags.error === 'not_found' ? m.common.notFound : m.common.error}
        </p>
      ) : null}
      {children}
    </section>
  );
}

const Field = ({ id, label, help, children }: { id: string; label: string; help?: string; children: (p: { id: string }) => ReactNode }) => (
  <FormField id={id} label={label} help={help}>
    {children}
  </FormField>
);

export function ProfileView({ profile, phone, flags, messages = customersMessages }: { profile: CustomerRow | null; phone: string | null; flags: Flags; messages?: CustomersMessages }) {
  const m = messages;
  return (
    <Shell title={m.profile.title} intro={m.profile.intro} flags={flags} m={m}>
      <form action={saveProfileAction} className="flex flex-col gap-4">
        <Field id="displayName" label={m.profile.name}>
          {(p) => <Input {...p} name="displayName" required maxLength={120} autoComplete="name" defaultValue={profile?.displayName ?? ''} />}
        </Field>
        <Field id="phone" label={m.profile.phone} help={m.profile.phoneHelp}>
          {(p) => <Input {...p} value={phone ?? ''} readOnly disabled />}
        </Field>
        <Field id="email" label={m.profile.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={profile?.email ?? ''} />}
        </Field>
        <Field id="customerType" label={m.profile.type}>
          {(p) => (
            <Select {...p} name="customerType" defaultValue={profile?.customerType ?? 'individual'}>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {m.profile.types[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="gstin" label={m.profile.gstin} help={m.profile.gstinHelp}>
          {(p) => <Input {...p} name="gstin" maxLength={15} className="uppercase" defaultValue={profile?.gstin ?? ''} />}
        </Field>
        <Field id="legalName" label={m.profile.legalName}>
          {(p) => <Input {...p} name="legalName" maxLength={200} defaultValue={profile?.legalName ?? ''} />}
        </Field>
        <Button type="submit" data-cta="account-profile-save" className="self-start">
          {m.common.save}
        </Button>
      </form>
    </Shell>
  );
}

function AddressForm({ address, m }: { address: AddressRow | null; m: CustomersMessages }) {
  const a = m.addresses;
  const v = (k: keyof AddressRow) => (address?.[k] == null ? '' : String(address[k]));
  return (
    <form action={saveAddressAction} className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
      <h2 className="text-lg font-semibold text-primary sm:col-span-2">{address ? a.editTitle : a.add}</h2>
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <Field id="label" label={a.label}>
        {(p) => <Input {...p} name="label" maxLength={40} placeholder={a.labelPlaceholder} defaultValue={v('label')} />}
      </Field>
      <Field id="name" label={a.name}>
        {(p) => <Input {...p} name="name" required maxLength={120} autoComplete="name" defaultValue={v('name')} />}
      </Field>
      <Field id="phone" label={a.phone}>
        {(p) => <Input {...p} name="phone" type="tel" required inputMode="tel" autoComplete="tel" defaultValue={v('phone')} />}
      </Field>
      <Field id="line1" label={a.line1}>
        {(p) => <Input {...p} name="line1" required maxLength={200} autoComplete="address-line1" defaultValue={v('line1')} />}
      </Field>
      <Field id="line2" label={a.line2}>
        {(p) => <Input {...p} name="line2" maxLength={200} autoComplete="address-line2" defaultValue={v('line2')} />}
      </Field>
      <Field id="landmark" label={a.landmark}>
        {(p) => <Input {...p} name="landmark" maxLength={200} defaultValue={v('landmark')} />}
      </Field>
      <Field id="villageTown" label={a.villageTown}>
        {(p) => <Input {...p} name="villageTown" maxLength={120} autoComplete="address-level3" defaultValue={v('villageTown')} />}
      </Field>
      <Field id="pincode" label={a.pincode}>
        {(p) => <Input {...p} name="pincode" required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} autoComplete="postal-code" defaultValue={v('pincode')} />}
      </Field>
      <Field id="districtText" label={a.district}>
        {(p) => <Input {...p} name="districtText" required maxLength={120} autoComplete="address-level2" defaultValue={v('districtText')} />}
      </Field>
      {address?.districtId ? <input type="hidden" name="districtId" value={address.districtId} /> : null}
      <Field id="state" label={a.state}>
        {(p) => <Input {...p} name="state" required maxLength={80} autoComplete="address-level1" defaultValue={v('state')} />}
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox name="isDefault" defaultChecked={address?.isDefault ?? false} />
        {a.makeDefault}
      </label>
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" data-cta="account-address-save">
          {m.common.save}
        </Button>
        {address ? (
          <Link href="/account/addresses" className="self-center text-sm text-primary underline">
            {m.common.cancel}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export function AddressesView({ addresses, flags, messages = customersMessages }: { addresses: AddressRow[]; flags: Flags; messages?: CustomersMessages }) {
  const m = messages;
  const editing = flags.edit ? (addresses.find((a) => a.id === flags.edit) ?? null) : null;
  return (
    <Shell title={m.addresses.title} intro={m.addresses.intro} flags={flags} m={m}>
      {addresses.length === 0 ? (
        <EmptyState title={m.addresses.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.label ?? a.name}</span>
                {a.isDefault ? <Badge tone="success">{m.addresses.default}</Badge> : null}
              </div>
              <p className="text-sm text-muted">{[a.name, a.line1, a.line2, a.landmark, a.villageTown, a.districtText, a.state, a.pincode].filter(Boolean).join(', ')}</p>
              <p className="text-sm text-muted">{a.phone}</p>
              <div className="flex gap-3">
                <Link href={`/account/addresses?edit=${a.id}`} className="text-sm text-primary underline" data-cta="account-address-edit">
                  {m.common.edit}
                </Link>
                <form action={deleteAddressAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="text-sm text-danger underline" data-cta="account-address-delete">
                    {m.common.delete}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AddressForm key={editing?.id ?? 'new'} address={editing} m={m} />
    </Shell>
  );
}

export function LandView({ land, flags, messages = customersMessages }: { land: LandRow[]; flags: Flags; messages?: CustomersMessages }) {
  const m = messages;
  const editing = flags.edit ? (land.find((l) => l.id === flags.edit) ?? null) : null;
  return (
    <Shell title={m.land.title} intro={m.land.intro} flags={flags} m={m}>
      {land.length === 0 ? (
        <EmptyState title={m.land.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {land.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-col">
                <span className="font-semibold">{l.label}</span>
                <span className="text-sm text-muted">{m.land.area(l.sqft)}</span>
              </div>
              <div className="flex gap-3">
                <Link href={`/account/land?edit=${l.id}`} className="text-sm text-primary underline" data-cta="account-land-edit">
                  {m.common.edit}
                </Link>
                <form action={deleteLandAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <button type="submit" className="text-sm text-danger underline" data-cta="account-land-delete">
                    {m.common.delete}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form key={editing?.id ?? 'new'} action={saveLandAction} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-primary">{editing ? m.land.editTitle : m.land.add}</h2>
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        {editing?.districtId ? <input type="hidden" name="districtId" value={editing.districtId} /> : null}
        {editing?.planId ? <input type="hidden" name="planId" value={editing.planId} /> : null}
        {editing?.purpose ? <input type="hidden" name="purpose" value={editing.purpose} /> : null}
        <Field id="land-label" label={m.land.label}>
          {(p) => <Input {...p} name="label" required maxLength={80} placeholder={m.land.labelPlaceholder} defaultValue={editing?.label ?? ''} />}
        </Field>
        <Field id="land-sqft" label={m.land.sqft} help={m.land.sqftHelp}>
          {(p) => <Input {...p} name="sqft" type="number" required min={1} step="any" inputMode="decimal" defaultValue={editing?.sqft ?? ''} />}
        </Field>
        <Button type="submit" data-cta="account-land-save" className="self-start">
          {m.common.save}
        </Button>
      </form>
    </Shell>
  );
}
