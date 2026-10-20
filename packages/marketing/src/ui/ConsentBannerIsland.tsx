'use client';

import { Button, Checkbox } from '@ecomkit/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CONSENT_COOKIE, parseConsent } from '../domain/consent';
import type { MarketingMessages } from '../messages';
import { CONSENT_EVENT, CONSENT_OPEN_EVENT, readBrowserCookie } from './browser';

const SERVER = 'server';
const subscribe = (onChange: () => void) => {
  window.addEventListener(CONSENT_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_EVENT, onChange);
};

/**
 * Cookie choice banner. Shown until the visitor chooses; reopened by `openConsentSettings()`. Saving posts to
 * /api/consent (which sets the cookie and records the choice for a signed-in customer) and tells the tag loader.
 */
export function ConsentBannerIsland({ messages, endpoint = '/api/consent' }: { messages: MarketingMessages['consent']; endpoint?: string }) {
  const stored = useSyncExternalStore(subscribe, () => readBrowserCookie(CONSENT_COOKIE) ?? '', () => SERVER);
  const [reopened, setReopened] = useState(false);
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const reopen = () => {
      const c = parseConsent(readBrowserCookie(CONSENT_COOKIE));
      setAnalytics(!!c?.analytics);
      setMarketing(!!c?.marketing);
      setDetails(true);
      setReopened(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  async function save(choice: { analytics: boolean; marketing: boolean }) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(choice), credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      setReopened(false);
      window.dispatchEvent(new Event(CONSENT_EVENT));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const open = reopened || (stored !== SERVER && !parseConsent(stored));
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="false" aria-label={messages.dialogLabel} className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-lg border border-border bg-surface p-4 text-sm text-text shadow-card md:inset-x-auto md:right-4 md:bottom-4">
      <p className="font-display text-base">{messages.title}</p>
      <p className="mt-1 text-muted">{messages.body}</p>
      {details && (
        <ul className="mt-3 flex flex-col gap-2">
          <li className="flex items-start gap-2">
            <Checkbox checked disabled aria-describedby="ek-consent-essential" />
            <span>
              <span className="font-semibold">{messages.essential}</span> <span id="ek-consent-essential" className="text-muted">{messages.essentialHelp}</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Checkbox id="ek-consent-analytics" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <label htmlFor="ek-consent-analytics">
              <span className="font-semibold">{messages.analytics}</span> <span className="text-muted">{messages.analyticsHelp}</span>
            </label>
          </li>
          <li className="flex items-start gap-2">
            <Checkbox id="ek-consent-marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <label htmlFor="ek-consent-marketing">
              <span className="font-semibold">{messages.marketing}</span> <span className="text-muted">{messages.marketingHelp}</span>
            </label>
          </li>
        </ul>
      )}
      {failed && (
        <p role="alert" className="mt-2 text-danger">
          {messages.error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {details ? (
          <Button size="sm" disabled={busy} data-cta="consent-save" onClick={() => save({ analytics, marketing })}>
            {messages.save}
          </Button>
        ) : (
          <Button size="sm" variant="subtle" disabled={busy} data-cta="consent-customise" onClick={() => setDetails(true)}>
            {messages.customise}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} data-cta="consent-reject" onClick={() => save({ analytics: false, marketing: false })}>
          {messages.rejectAll}
        </Button>
        <Button size="sm" disabled={busy} data-cta="consent-accept" onClick={() => save({ analytics: true, marketing: true })}>
          {messages.acceptAll}
        </Button>
      </div>
    </div>
  );
}
