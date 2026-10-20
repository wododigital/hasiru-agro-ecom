import type { AssistantMessages } from '../messages';
import type { Intent } from './types';

export type Lexicon = AssistantMessages['lexicon'];

export interface ParsedQuestion {
  text: string;
  /** Lowercased content words (stop words and intent words removed), singular forms. */
  terms: string[];
  intents: Intent[];
  maxPricePaise: number | null;
  bearingWithinYears: number | null;
  acres: number | null;
  /** Words after "in" / "at" that may name a place ("what grows in Mysuru"). */
  placeQuery: string | null;
}

// Generic English filler, never matched against product names.
const STOP = new Set(
  'a an and any are as at be best buy can could do does for from good great have help how i in is it like me my need of on or our please plot place plant plants product products recommend show some suggest tell than that the their there these this those to under below what when where which who why will with within would you your want get give list about all much many more most less only also than other which one ones item items acre acres year years rs inr each per price prices cost costs cheap cheaper budget sell selling grow grows growing well together already planted add along'.split(
    ' ',
  ),
);

export const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/₹/g, ' rs ')
    .replace(/[^\p{L}\p{N}.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Crude singular: "mangoes" -> "mango", "trees" -> "tree", "species" stays. */
export function singular(word: string): string {
  if (word.length <= 3 || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

const hasPhrase = (text: string, phrase: string): boolean => new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(text);

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Deterministic intent parser. Words come from the messages lexicon (host-overridable), so the module carries
 * no store vocabulary; category and product words are matched later against the live catalogue.
 */
export function parseQuestion(question: string, lexicon: Lexicon): ParsedQuestion {
  const raw = question.toLowerCase();
  const text = normalise(question);
  const intents = new Set<Intent>();
  const lexWords = new Set<string>();
  for (const [intent, phrases] of Object.entries(lexicon) as [Intent, readonly string[]][]) {
    for (const p of phrases) {
      if (hasPhrase(text, p)) {
        intents.add(intent);
        for (const w of p.split(' ')) lexWords.add(w);
      }
    }
  }

  // "under Rs 400", "below 400": a cap with a currency mark, or a bare number not followed by a unit (2 years, 3 acres).
  const price = /(?:under|below|less than|within|upto|up to|max|maximum|cheaper than)\s*(?:(?:rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)(?![\d,.])(?!\s*(?:years?|yrs?|acres?|ac\b|ft|feet|kg|months?|days?|cm|plants?|trees?|saplings?|%)))/.exec(
    raw.replace(/₹\s*/g, 'rs '),
  );
  const maxRupees = num(price?.[1] ?? price?.[2]);
  if (maxRupees != null) intents.add('price');

  const bearing = /(?:in|within|under|by|after)?\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/.exec(text);
  const bearingYears = bearing && intents.has('bearing') ? num(bearing[1]) : null;

  const area = /(\d+(?:\.\d+)?)\s*(?:acres?|ac)\b/.exec(text);
  const acres = num(area?.[1]);
  if (acres != null && acres > 0) intents.add('acreage');

  const place = /\b(?:in|at|near|around)\s+([a-z][a-z .-]{2,40})$/.exec(text.replace(/[.?!]+$/, ''));
  const placeQuery = intents.has('fit') && place?.[1] ? place[1].replace(/\b(district|area|region|taluk)\b/g, '').trim() || null : null;

  const placeWords = new Set(placeQuery?.split(' ') ?? []);
  const terms = [
    ...new Set(
      text
        .split(' ')
        .filter((w) => w.length >= 3 && !/^\d/.test(w) && !STOP.has(w) && !lexWords.has(w) && !placeWords.has(w))
        .map(singular),
    ),
  ];

  // Only treat a question as off topic when nothing in it could be about the catalogue.
  if (intents.has('offTopic') && intents.size > 1) intents.delete('offTopic');

  return {
    text,
    terms,
    intents: [...intents],
    maxPricePaise: maxRupees != null ? Math.round(maxRupees * 100) : null,
    bearingWithinYears: bearingYears,
    acres: acres != null && acres > 0 ? acres : null,
    placeQuery,
  };
}
