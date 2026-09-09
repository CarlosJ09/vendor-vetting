/**
 * Name normalisation and comparison for the cross-document coherence checks.
 *
 * Two documents can name the same company as "Constructora del Caribe, S.R.L."
 * and "CONSTRUCTORA DEL CARIBE SRL" without anything being wrong. The job here
 * is to absorb that variation while refusing to absorb a real discrepancy: a
 * name that is close but not equal comes back as `near`, which the dossier
 * renders as a warning for a human, never as a silent pass.
 */

import { NAME_NEAR_MATCH_THRESHOLD } from "./config";

/** Legal forms as token sequences, matched only at the end of a company name. */
const LEGAL_SUFFIXES: readonly (readonly string[])[] = [
  ["c", "por", "a"], // Compañía por Acciones
  ["e", "i", "r", "l"],
  ["eirl"],
  ["s", "a", "s"],
  ["sas"],
  ["s", "r", "l"],
  ["srl"],
  ["s", "a"],
  ["sa"],
];

/** Titles that may precede a person's name on a certification. */
const HONORIFICS = new Set([
  "lic",
  "licda",
  "lcdo",
  "lcda",
  "dr",
  "dra",
  "ing",
  "arq",
  "sr",
  "sra",
  "srta",
]);

/**
 * Lowercase, strip diacritics, reduce anything non-alphanumeric to a space, and
 * collapse runs of whitespace. Punctuation becomes a separator rather than being
 * deleted, so `S.R.L.` yields the tokens `s r l` instead of the word `srl` —
 * that distinction is what lets the suffix table match both spellings.
 */
function foldToTokens(input: string): string[] {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function endsWithSequence(tokens: string[], sequence: readonly string[]): boolean {
  if (sequence.length > tokens.length) return false;
  const offset = tokens.length - sequence.length;
  return sequence.every((token, i) => tokens[offset + i] === token);
}

/**
 * Canonical form of a company name: folded, with any trailing legal form removed.
 *
 * Stripping is anchored to the end so a name like "Grupo Sa Vida SRL" keeps its
 * internal `Sa`. If removing the suffix would leave nothing, the unstripped form
 * is kept instead — otherwise every company named only by its legal form would
 * normalize to the empty string and compare equal to every other.
 */
export function normalizeCompanyName(input: string): string {
  let tokens = foldToTokens(input);

  let stripped = true;
  while (stripped && tokens.length > 0) {
    stripped = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (endsWithSequence(tokens, suffix)) {
        const remainder = tokens.slice(0, tokens.length - suffix.length);
        if (remainder.length === 0) return tokens.join(" ");
        tokens = remainder;
        stripped = true;
        break;
      }
    }
  }

  return tokens.join(" ");
}

/** Canonical form of a person's name: folded, with any leading honorific removed. */
export function normalizePersonName(input: string): string {
  const tokens = foldToTokens(input);
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) {
    tokens.shift();
  }
  return tokens.join(" ");
}

/** Levenshtein edit distance, computed with a rolling row. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current.slice();
  }

  return previous[b.length];
}

/** Edit-distance similarity in `[0, 1]`, where 1 means identical. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

export type NameVerdict = "match" | "near" | "mismatch";

export interface NameComparison {
  verdict: NameVerdict;
  /** Similarity of the two normalized forms, in `[0, 1]`. */
  score: number;
  normalizedA: string;
  normalizedB: string;
}

/** True when every token of the shorter name also appears in the longer one. */
function isTokenSubset(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const shortTokens = shorter.split(" ").filter(Boolean);
  const longTokens = new Set(longer.split(" ").filter(Boolean));
  if (shortTokens.length === 0) return false;
  return shortTokens.every((token) => longTokens.has(token));
}

function verdictFromScore(score: number): NameVerdict {
  return score >= NAME_NEAR_MATCH_THRESHOLD ? "near" : "mismatch";
}

/** Compare two company names after normalising away case, accents and legal forms. */
export function compareCompanyNames(a: string, b: string): NameComparison {
  const normalizedA = normalizeCompanyName(a);
  const normalizedB = normalizeCompanyName(b);

  if (normalizedA === normalizedB) {
    return { verdict: "match", score: 1, normalizedA, normalizedB };
  }

  const score = similarity(normalizedA, normalizedB);
  return { verdict: verdictFromScore(score), score, normalizedA, normalizedB };
}

/**
 * Compare two person names.
 *
 * Differs from the company comparison in one way: a name whose tokens are a
 * subset of the other's is treated as a near-miss regardless of edit distance.
 * Dropping a middle name is common and usually benign, but "usually benign" is
 * a human's call to make, so it surfaces as a warning rather than a pass.
 */
export function comparePersonNames(a: string, b: string): NameComparison {
  const normalizedA = normalizePersonName(a);
  const normalizedB = normalizePersonName(b);

  if (normalizedA === normalizedB) {
    return { verdict: "match", score: 1, normalizedA, normalizedB };
  }

  const score = similarity(normalizedA, normalizedB);

  if (isTokenSubset(normalizedA, normalizedB)) {
    return { verdict: "near", score, normalizedA, normalizedB };
  }

  return { verdict: verdictFromScore(score), score, normalizedA, normalizedB };
}
