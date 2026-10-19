import { TBody, Table, Td, Th, Tr } from '@ecomkit/ui';
import type { CatalogMessages } from '../messages';

export function KeyFacts({ facts, messages }: { facts: readonly { name: string; value: string }[]; messages: CatalogMessages }) {
  if (!facts.length) return null;
  return (
    <section aria-labelledby="facts-title" className="flex flex-col gap-2">
      <h2 id="facts-title" className="font-display text-xl">
        {messages.pdp.keyFacts}
      </h2>
      <Table>
        <TBody>
          {facts.map((f) => (
            <Tr key={f.name}>
              <Th scope="row" className="w-2/5 text-left">
                {f.name}
              </Th>
              <Td>{f.value}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

/** Sanitised on save (core.safeHtml); rendered as-is here. */
export function RichText({ id, title, html }: { id: string; title: string; html: string | null }) {
  if (!html) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-display text-xl">
        {title}
      </h2>
      {/* eslint-disable-next-line react/no-danger -- sanitised by core.safeHtml when saved */}
      <div className="prose max-w-none text-text" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

export function FaqList({ faqs, messages }: { faqs: readonly { question: string; answerHtml: string }[]; messages: CatalogMessages }) {
  if (!faqs.length) return null;
  return (
    <section aria-labelledby="faq-title" className="flex flex-col gap-2">
      <h2 id="faq-title" className="font-display text-xl">
        {messages.pdp.faq}
      </h2>
      {faqs.map((f) => (
        <details key={f.question} className="rounded-md border border-border bg-surface p-3">
          <summary className="cursor-pointer font-semibold" data-cta="pdp-faq-toggle">
            {f.question}
          </summary>
          {/* eslint-disable-next-line react/no-danger -- sanitised by core.safeHtml when saved */}
          <div className="pt-2 text-sm" dangerouslySetInnerHTML={{ __html: f.answerHtml }} />
        </details>
      ))}
    </section>
  );
}

export function TrustRow({ messages }: { messages: CatalogMessages }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {messages.pdp.trust.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="text-sm font-semibold">{messages.pdp.noReturns}</p>
    </div>
  );
}

/** JSON-LD text comes pre-escaped from the seo module's graph(). */
export function JsonLdScript({ json }: { json: string | null }) {
  if (!json) return null;
  // eslint-disable-next-line react/no-danger -- escaped by jsonLd.graph()
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
