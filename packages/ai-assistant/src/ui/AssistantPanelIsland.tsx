'use client';

import { Button, Input, Segmented, SheetContent, Sheet, Skeleton } from '@ecomkit/ui';
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { fill } from '../domain/narration';
import { parseAnswer, type Inline } from '../domain/markdown';
import { MAX_QUESTION, type AnswerSource, type ChipProduct, type ErrorCode, type StreamEvent } from '../domain/stream';
import { MODES, type AssistantMode } from '../domain/types';
import type { AssistantMessages } from '../messages';
import { loadAssistantCards } from './cards-action';

export type AssistantCopy = Pick<AssistantMessages, 'drawer' | 'modes' | 'suggestions' | 'errors'>;

export interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: AssistantCopy;
  streamPath: string;
  /** The cart contract (POST JSON { variantId, delta }); null when the cart module is off. */
  cart: { path: string; changedEvent: string } | null;
}

interface Turn {
  id: number;
  question: string;
  answer: string;
  products: ChipProduct[];
  productIds: string[];
  followUps: string[];
  source: AnswerSource | null;
  error: ErrorCode | 'network' | 'cut_short' | null;
  done: boolean;
  cards: ReactNode;
}

const STORE_KEY = 'ecomkit.assistant.conversation';
const readConversation = (): string | null => {
  try {
    return sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const writeConversation = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORE_KEY, id);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // storage blocked: the conversation simply starts fresh next time
  }
};

function ProductToken({ product, cart, copy }: { product: ChipProduct | undefined; cart: PanelProps['cart']; copy: AssistantCopy }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  if (!product) return null;
  const chip = 'mx-0.5 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-surface px-2 py-0.5 align-baseline text-sm font-semibold text-primary';
  if (!cart || !product.purchasable || !product.variantId) {
    return (
      <a href={product.href} className={`${chip} underline-offset-2 hover:underline`} data-cta="assistant-open-product" aria-label={fill(copy.drawer.openProduct, { name: product.name })}>
        {product.name}
      </a>
    );
  }
  const add = async () => {
    setState('busy');
    try {
      const res = await fetch(cart.path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ variantId: product.variantId, delta: 1 }) });
      if (!res.ok) throw new Error(String(res.status));
      window.dispatchEvent(new CustomEvent(cart.changedEvent));
      setState('added');
    } catch {
      setState('idle');
    }
  };
  return (
    <span className="inline-flex items-baseline">
      <a href={product.href} className="font-semibold text-primary underline-offset-2 hover:underline">
        {product.name}
      </a>
      <button type="button" onClick={add} disabled={state !== 'idle'} className={chip} aria-label={fill(copy.drawer.addToCart, { name: product.name })} data-cta="assistant-add-to-cart">
        {state === 'added' ? copy.drawer.added : '+'}
      </button>
    </span>
  );
}

function InlineParts({ parts, turn, cart, copy }: { parts: Inline[]; turn: Turn; cart: PanelProps['cart']; copy: AssistantCopy }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <ProductToken key={i} product={turn.products.find((x) => x.id === p.id)} cart={cart} copy={copy} />
        ),
      )}
    </>
  );
}

function AnswerView({ turn, cart, copy }: { turn: Turn; cart: PanelProps['cart']; copy: AssistantCopy }) {
  return (
    <div className="flex flex-col gap-2 text-[15px] leading-relaxed">
      {parseAnswer(turn.answer).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            <InlineParts parts={b.parts} turn={turn} cart={cart} copy={copy} />
          </p>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <InlineParts parts={item} turn={turn} cart={cart} copy={copy} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** The assistant drawer: mode pill, suggested questions, streamed answers with product chips and a card rail. */
export function AssistantPanel({ open, onOpenChange, copy, streamPath, cart }: PanelProps) {
  const [mode, setMode] = useState<AssistantMode>('shop');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [, startCards] = useTransition();
  const conversation = useRef<string | null>(null);
  const nextId = useRef(1);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversation.current = readConversation();
  }, []);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const patch = (id: number, p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)));

  const ask = async (question: string) => {
    const q = question.trim().slice(0, MAX_QUESTION);
    if (!q || busy) return;
    const id = nextId.current++;
    setTurns((all) => [...all, { id, question: q, answer: '', products: [], productIds: [], followUps: [], source: null, error: null, done: false, cards: null }]);
    setText('');
    setBusy(true);
    let finished = false;
    try {
      const res = await fetch(streamPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, mode, conversationId: conversation.current }) });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: ErrorCode };
        patch(id, { error: body.error ?? 'failed', done: true });
        finished = true;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as StreamEvent;
          if (e.type === 'meta') {
            conversation.current = e.conversationId;
            writeConversation(e.conversationId);
            patch(id, { products: e.products });
          } else if (e.type === 'delta') patch(id, (t) => ({ answer: t.answer + e.text }));
          else if (e.type === 'error') {
            patch(id, { error: e.code, done: true });
            finished = true;
          } else if (e.type === 'done') {
            finished = true;
            patch(id, { source: e.source, productIds: e.productIds, followUps: e.followUps, done: true });
            if (e.productIds.length) startCards(async () => patch(id, { cards: await loadAssistantCards(e.productIds) }));
          }
        }
        if (done) break;
      }
    } catch {
      patch(id, { error: 'network', done: true });
      finished = true;
    } finally {
      if (!finished) patch(id, { error: 'cut_short', done: true });
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };
  const last = turns.at(-1);
  const chips = !turns.length ? copy.suggestions[mode] : last?.done ? last.followUps : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title={copy.drawer.title} description={copy.drawer.intro} closeLabel={copy.drawer.close} className="w-full max-w-md">
        <Segmented
          name="assistant-mode"
          label={copy.drawer.modeLabel}
          options={MODES.map((m) => ({ value: m, label: copy.modes[m] }))}
          value={mode}
          onChange={(v) => setMode(v as AssistantMode)}
        />
        <div className="flex flex-1 flex-col gap-4" aria-live="polite" aria-busy={busy}>
          <p className="rounded-md bg-surface-2 p-3 text-[15px]">{copy.drawer.greeting}</p>
          {turns.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <p className="self-end rounded-md bg-primary px-3 py-2 text-[15px] text-primary-fg">
                <span className="sr-only">{copy.drawer.you}</span>
                {t.question}
              </p>
              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
                <span className="sr-only">{copy.drawer.assistant}</span>
                {t.answer ? <AnswerView turn={t} cart={cart} copy={copy} /> : !t.error ? <p className="text-sm text-muted">{copy.drawer.pending}</p> : null}
                {t.error ? <p className="text-sm text-danger">{copy.errors[t.error]}</p> : null}
              </div>
              {t.productIds.length && !t.cards && t.done ? <Skeleton className="h-64 w-full" /> : t.cards}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
        {chips.length ? (
          <div className="flex flex-col gap-2">
            {turns.length ? <p className="text-xs text-muted">{copy.drawer.followUps}</p> : null}
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => void ask(c)} disabled={busy} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:bg-surface-2" data-cta="assistant-suggestion">
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="sticky bottom-0 flex gap-2 bg-bg pt-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_QUESTION} placeholder={copy.drawer.placeholder} aria-label={copy.drawer.placeholder} disabled={busy} className="flex-1" />
          <Button type="submit" disabled={busy || !text.trim()} data-cta="assistant-send">
            {copy.drawer.send}
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <p>{copy.drawer.footnote}</p>
          {turns.length ? (
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => {
                conversation.current = null;
                writeConversation(null);
                setTurns([]);
              }}
              data-cta="assistant-new-chat"
            >
              {copy.drawer.newChat}
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
