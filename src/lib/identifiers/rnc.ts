/**
 * RNC (Registro Nacional de Contribuyentes) — the 9-digit Dominican taxpayer
 * identifier, 8 payload digits followed by a modulus-11 check digit.
 *
 * VERIFIED. The algorithm below was cross-checked against two independent
 * reference implementations before being written, per the project's rule
 * against implementing checksums from memory:
 *
 *   1. python-stdnum `stdnum/do/rnc.py` (arthurdejong/python-stdnum)
 *        weights (7,9,8,6,5,4,3,2); check = sum % 11; digit = (10 - check) % 9 + 1
 *   2. gist gregorypilar/a2423d860f302ea156de2d0a69eba699
 *        same weights; digit = 2 if r == 0, 1 if r == 1, else 11 - r
 *
 * The two closed forms agree on all 11 residues; `rnc.test.ts` pins that
 * equivalence so neither can be refactored into disagreement silently.
 *
 * KNOWN LIMITATION — python-stdnum ships a whitelist of ~23 real RNCs that are
 * genuinely issued but fail this checksum. That whitelist is deliberately NOT
 * vendored here: it consists of real taxpayer identifiers, and this project
 * commits to handling no real registry data. Consequence: against real-world
 * input this validator has a small false-negative rate. Synthetic data is
 * unaffected. See README "Failure modes".
 */

const WEIGHTS = [7, 9, 8, 6, 5, 4, 3, 2] as const;

const RNC_BODY_LENGTH = WEIGHTS.length; // 8
const RNC_LENGTH = RNC_BODY_LENGTH + 1; // 9

/** Strip the conventional `1-01-85004-3` separators. Non-digits are preserved
 *  so that malformed input still fails validation instead of being coerced. */
export function normalizeRnc(input: string): string {
  return input.replace(/[\s.\-]/g, "");
}

/** Format a compact RNC in the conventional `1-01-85004-3` grouping. */
export function formatRnc(rnc: string): string {
  const compact = normalizeRnc(rnc);
  if (!/^\d{9}$/.test(compact)) return rnc;
  return `${compact.slice(0, 1)}-${compact.slice(1, 3)}-${compact.slice(3, 8)}-${compact.slice(8)}`;
}

/** The check digit for an 8-digit RNC payload. Throws on malformed input. */
export function calcRncCheckDigit(body: string): string {
  if (!new RegExp(`^\\d{${RNC_BODY_LENGTH}}$`).test(body)) {
    throw new Error(
      `RNC payload must be exactly ${RNC_BODY_LENGTH} digits, received ${JSON.stringify(body)}`,
    );
  }

  let sum = 0;
  for (let i = 0; i < RNC_BODY_LENGTH; i++) {
    sum += (body.charCodeAt(i) - 48) * WEIGHTS[i];
  }

  return String(((10 - (sum % 11)) % 9) + 1);
}

/** True when `input` is a well-formed RNC with a correct check digit. */
export function isValidRnc(input: string): boolean {
  const compact = normalizeRnc(input);
  if (!new RegExp(`^\\d{${RNC_LENGTH}}$`).test(compact)) return false;
  return calcRncCheckDigit(compact.slice(0, RNC_BODY_LENGTH)) === compact.slice(RNC_BODY_LENGTH);
}
