import { Button, FormField, Input, Select, Textarea } from '@ecomkit/ui';
import { formGuards } from '@ecomkit/core/validation';
import { ATTACHMENT_LIMITS, ENQUIRY_CUSTOMER_TYPES, UTM_KEYS, type EnquiryKind } from '../domain';
import { enquiriesMessages, type EnquiriesMessages, type EnquiryOutcomeKey } from '../messages';

export interface EnquiryFormProps {
  kind?: EnquiryKind;
  /** Path the visitor returns to after posting (this page). */
  returnTo: string;
  /** The page's search params: UTM/click ids are carried into hidden fields, `enquiry` shows the outcome. */
  searchParams?: Record<string, string | string[] | undefined>;
  /** Show land fields (acres, location, timeline). Defaults to true for farm development. */
  landFields?: boolean;
  /** Show the private upload field (needs the media module's private store). */
  uploads?: boolean;
  messages?: EnquiriesMessages;
  className?: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The public enquiry form: a plain multipart POST to /api/enquiry that works without JavaScript, with a
 * honeypot and a signed time token. Render it dynamically (the time token is issued per request).
 */
export function EnquiryForm({ kind = 'farm_development', returnTo, searchParams = {}, landFields, uploads = true, messages = enquiriesMessages, className }: EnquiryFormProps) {
  const m = messages.form;
  const showLand = landFields ?? kind === 'farm_development';
  const outcome = first(searchParams.enquiry) as EnquiryOutcomeKey | undefined;
  const outcomeText = outcome && outcome in messages.outcome ? messages.outcome[outcome] : null;
  return (
    <form id="enquiry" method="post" action="/api/enquiry" encType="multipart/form-data" className={className ?? 'grid gap-4 sm:grid-cols-2'}>
      {outcomeText ? (
        <p role={outcome === 'sent' ? 'status' : 'alert'} className={`rounded-md px-3 py-2 text-sm sm:col-span-2 ${outcome === 'sent' ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'}`}>
          {outcomeText}
        </p>
      ) : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="_return" value={returnTo} />
      <input type="hidden" name={formGuards.timeField} value={formGuards.issue()} />
      {UTM_KEYS.map((k) => {
        const v = first(searchParams[k]);
        return v ? <input key={k} type="hidden" name={k} value={v.slice(0, 200)} /> : null;
      })}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {m.honeypot}
          <input type="text" name={formGuards.honeypotField} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <FormField id="enquiry-name" label={m.name} required>
        {(p) => <Input {...p} name="name" required minLength={2} maxLength={120} autoComplete="name" />}
      </FormField>
      <FormField id="enquiry-phone" label={m.phone} help={m.phoneHelp} required>
        {(p) => <Input {...p} name="phone" type="tel" required inputMode="tel" autoComplete="tel" pattern="[+0-9 ()-]{10,16}" />}
      </FormField>
      <FormField id="enquiry-type" label={m.customerType}>
        {(p) => (
          <Select {...p} name="customerType" defaultValue="farmer">
            {ENQUIRY_CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {m.customerTypes[t]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="enquiry-email" label={m.email} help={m.optional}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" />}
      </FormField>
      {showLand ? (
        <>
          <FormField id="enquiry-acres" label={m.acres} required>
            {(p) => <Input {...p} name="acres" type="number" required min={1} step="any" inputMode="decimal" />}
          </FormField>
          <FormField id="enquiry-location" label={m.location} required>
            {(p) => <Input {...p} name="location" required maxLength={200} placeholder={m.locationPlaceholder} autoComplete="address-level2" />}
          </FormField>
          <FormField id="enquiry-timeline" label={m.timeline} className="sm:col-span-2">
            {(p) => (
              <Select {...p} name="timeline" defaultValue={m.timelines[0]}>
                {m.timelines.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </>
      ) : null}
      <FormField id="enquiry-requirement" label={m.requirement} required={!showLand} className="sm:col-span-2">
        {(p) => <Textarea {...p} name="requirement" maxLength={4000} required={!showLand} />}
      </FormField>
      <FormField id="enquiry-notes" label={m.notes} help={m.optional} className="sm:col-span-2">
        {(p) => <Textarea {...p} name="notes" maxLength={4000} />}
      </FormField>
      {uploads ? (
        <FormField id="enquiry-files" label={m.files} help={m.filesHelp} className="sm:col-span-2">
          {(p) => <Input {...p} name="files" type="file" multiple accept={ATTACHMENT_LIMITS.types.join(',')} />}
        </FormField>
      ) : null}
      <Button type="submit" size="lg" data-cta="enquiry-submit" className="sm:col-span-2 sm:justify-self-start">
        {m.submit}
      </Button>
    </form>
  );
}
