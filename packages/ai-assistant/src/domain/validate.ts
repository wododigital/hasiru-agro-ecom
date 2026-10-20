import type { ModelFacts, Narration } from './narration';

export interface ValidationResult {
  narration: Narration;
  /** Product refs the narrator invented (not in the facts). */
  droppedRefs: string[];
  /** Sentences removed because they quoted a price or a count the facts do not contain. */
  droppedSentences: string[];
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const canon = (s: string): string => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : s;
};

/** Numbers the narration may quote as counts: every number in the facts (refs excluded) or the question. */
export function allowedNumbers(view: ModelFacts): Set<string> {
  const text = JSON.stringify([view.question, view.lead, view.notes, view.products.map(({ ref: _ref, ...rest }) => rest)]);
  return new Set((text.match(NUM) ?? []).map(canon));
}

const MONEY = /(?:\brs\.?|\binr|₹)\s?(\d[\d,]*(?:\.\d+)?)/gi;

/** Amounts the narration may quote as money: rupee amounts in the facts, and any number the visitor typed. */
export function allowedAmounts(view: ModelFacts): Set<string> {
  const facts = JSON.stringify([view.lead, view.notes, view.products]);
  return new Set([...[...facts.matchAll(MONEY)].map((m) => canon(m[1]!)), ...(view.question.match(NUM) ?? []).map(canon)]);
}

/** No em dashes in shipped copy: an em dash becomes a comma, an en dash between numbers becomes "to". */
export function fixDashes(s: string): string {
  return s
    .replace(/(\d)\s*\u2013\s*(\d)/g, '$1 to $2')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Grounding check on a narration against the facts it was given:
 * - `[[ref]]` tokens that are not in the facts are removed (and listed);
 * - a sentence quoting a rupee amount, or a count of items ("40 saplings"), that the facts do not contain is
 *   removed whole, so a wrong price or quantity never reaches the visitor;
 * - em dashes are rewritten, markdown headings and table pipes are flattened.
 * The caller falls back to the template when nothing useful is left.
 */
export function validateNarration(input: Narration, view: ModelFacts, countWords: readonly string[]): ValidationResult {
  const refs = new Set(view.products.map((p) => p.ref));
  const numbers = allowedNumbers(view);
  const amounts = allowedAmounts(view);
  const droppedRefs: string[] = [];
  const droppedSentences: string[] = [];
  const counts = countWords.length ? new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s+(?:${countWords.map(escape).join('|')})\\b`, 'gi') : null;

  const grounded = (sentence: string): boolean => {
    for (const m of sentence.matchAll(MONEY)) if (!amounts.has(canon(m[1]!))) return false;
    if (counts) for (const m of sentence.matchAll(counts)) if (!numbers.has(canon(m[1]!))) return false;
    return true;
  };
  const cleanRefs = (s: string): string =>
    s.replace(/\[\[([^\]]*)\]\]/g, (all, ref: string) => {
      const r = ref.trim().toLowerCase();
      return refs.has(r) ? `[[${r}]]` : '';
    });
  // Every invented ref is reported, including those inside sentences dropped for an ungrounded number.
  for (const m of input.answer.matchAll(/\[\[([^\]]*)\]\]/g)) if (!refs.has(m[1]!.trim().toLowerCase())) droppedRefs.push(m[1]!);

  const lines = fixDashes(input.answer.replace(/\r/g, ''))
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:[-*•]|\d+[.)])\s+)?(.*)$/.exec(line.replace(/^#+\s*/, '').replace(/\|/g, ' '))!;
      const bullet = m[1] ? '- ' : '';
      const sentences = (m[2] ?? '').split(/(?<=[.!?])\s+/);
      const kept = sentences.filter((s) => {
        if (grounded(s)) return true;
        droppedSentences.push(s);
        return false;
      });
      const body = cleanRefs(kept.join(' '))
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s,.:;]+(?=\S)/, '')
        .trim();
      if (!/[\p{L}\p{N}]|\[\[/u.test(body)) return line.trim() ? null : '';
      return `${bullet}${body}`;
    })
    .filter((l): l is string => l !== null);
  const answer = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const inText = [...answer.matchAll(/\[\[(p\d+)\]\]/g)].map((x) => x[1]!);
  const productIds = [...new Set([...inText, ...input.productIds.map((r) => r.trim().toLowerCase()).filter((r) => refs.has(r))])];
  const followUps = input.followUps
    .map((q) => fixDashes(q).trim())
    .filter((q) => q.length > 0 && q.length <= 160 && !/\[\[/.test(q) && grounded(q))
    .slice(0, 3);

  return { narration: { answer, productIds, followUps }, droppedRefs, droppedSentences };
}

/** True when a validated narration still says something (it names a product or has a sentence of text). */
export function hasSubstance(n: Narration): boolean {
  return n.answer.replace(/\[\[p\d+\]\]/g, 'x').replace(/[^\p{L}]/gu, '').length >= 12;
}
