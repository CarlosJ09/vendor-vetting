/**
 * Freshness and date-sanity rules.
 *
 * All of this is deterministic code by design (§3). The model is never asked
 * whether a document is expired — only what dates are printed on it. Everything
 * below decides what those dates imply.
 *
 * Two kinds of expiry exist in this domain and they are handled separately:
 *
 *  - **Explicit** — the Registro Mercantil prints its own `fecha_vencimiento`.
 *    The document is the authority; no config is involved.
 *  - **Implicit** — the DGII and TSS certifications print only an issue date and
 *    are treated as valid for a window measured from it. That window is a config
 *    constant (see `config.ts`), and it is an assumption, not a verified legal
 *    fact.
 *
 * Boundary convention: a document is valid *through* its expiry date. On the
 * expiry date itself `daysRemaining` is 0 and the verdict is `warn`, not `fail`.
 */

import { addDays, compareDates, daysBetween, type PlainDate } from "@/lib/dates";
import type { RequirementStatus } from "@/lib/domain/types";

export interface ExpiryEvaluation {
  status: Extract<RequirementStatus, "pass" | "warn" | "fail">;
  /** The date the document stops being valid, inclusive. */
  expiryDate: PlainDate;
  /** Days from the reference date to expiry; negative once expired. */
  daysRemaining: number;
}

function classify(
  expiryDate: PlainDate,
  reference: PlainDate,
  warningDays: number,
): ExpiryEvaluation {
  const daysRemaining = daysBetween(reference, expiryDate);

  const status: ExpiryEvaluation["status"] =
    daysRemaining < 0 ? "fail" : daysRemaining <= warningDays ? "warn" : "pass";

  return { status, expiryDate, daysRemaining };
}

/** Freshness for a document that prints its own expiry date. */
export function evaluateExplicitExpiry(
  expiryDate: PlainDate,
  reference: PlainDate,
  warningDays: number,
): ExpiryEvaluation {
  return classify(expiryDate, reference, warningDays);
}

/**
 * Freshness for a document whose expiry is derived from its issue date.
 *
 * `windowDays` is supplied by the caller rather than read from config here, so
 * the rule stays a pure function and the policy stays in one place.
 */
export function evaluateImplicitExpiry(
  issueDate: PlainDate,
  windowDays: number,
  reference: PlainDate,
  warningDays: number,
): ExpiryEvaluation {
  return classify(addDays(issueDate, windowDays), reference, warningDays);
}

export type DateProblem = "issue_date_in_future" | "expiry_before_issue";

export interface DateSanityResult {
  ok: boolean;
  problems: DateProblem[];
}

/**
 * Structural checks on a document's dates, independent of freshness.
 *
 * Returns every problem found rather than the first: a document with both a
 * future issue date and an inverted range has two distinct things wrong, and a
 * reviewer should see both.
 */
export function checkDateSanity(input: {
  issued: PlainDate;
  expires?: PlainDate;
  reference: PlainDate;
}): DateSanityResult {
  const problems: DateProblem[] = [];

  if (compareDates(input.issued, input.reference) > 0) {
    problems.push("issue_date_in_future");
  }

  if (input.expires !== undefined && compareDates(input.expires, input.issued) < 0) {
    problems.push("expiry_before_issue");
  }

  return { ok: problems.length === 0, problems };
}
