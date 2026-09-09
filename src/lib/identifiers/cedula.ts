/**
 * Cedula de identidad y electoral — the 11-digit Dominican national ID number,
 * 10 payload digits followed by a Luhn (modulus 10) check digit.
 *
 * VERIFIED. Cross-checked against two independent references before writing:
 *
 *   1. python-stdnum `stdnum/do/cedula.py`, which delegates to `stdnum.luhn`
 *      after asserting an 11-digit length
 *   2. hminaya/SDQ and sebasjoa/Valida-cedula-dominicana, which describe the
 *      same construction as weights [1,2,1,2,...] over the first 10 digits with
 *      digit = (10 - sum % 10) % 10
 *
 * Both reduce to plain Luhn over the full 11 digits. `cedula.test.ts` pins the
 * published vector 00113918205 (valid) / 00113918204 (invalid).
 *
 * KNOWN LIMITATION — python-stdnum ships a whitelist of ~1,500 real cedulas that
 * are genuinely issued but fail Luhn. That whitelist is deliberately NOT vendored
 * here: it is a list of real people's national ID numbers, and this project
 * commits to handling no real personal data. Consequence: against real-world
 * input this validator has a small false-negative rate, which for a vetting
 * system is the safe direction (it flags for review rather than passing).
 * Synthetic data is unaffected. See README "Failure modes".
 */

import { luhnCheckDigit, luhnIsValid } from "./luhn";

const CEDULA_BODY_LENGTH = 10;
const CEDULA_LENGTH = CEDULA_BODY_LENGTH + 1; // 11

/** Strip the conventional `001-1391820-5` separators. Non-digits are preserved
 *  so that malformed input still fails validation instead of being coerced. */
export function normalizeCedula(input: string): string {
  return input.replace(/[\s.\-]/g, "");
}

/** Format a compact cedula in the conventional `001-1391820-5` grouping. */
export function formatCedula(cedula: string): string {
  const compact = normalizeCedula(cedula);
  if (!/^\d{11}$/.test(compact)) return cedula;
  return `${compact.slice(0, 3)}-${compact.slice(3, 10)}-${compact.slice(10)}`;
}

/** The check digit for a 10-digit cedula payload. Throws on malformed input. */
export function calcCedulaCheckDigit(body: string): string {
  if (!new RegExp(`^\\d{${CEDULA_BODY_LENGTH}}$`).test(body)) {
    throw new Error(
      `Cedula payload must be exactly ${CEDULA_BODY_LENGTH} digits, received ${JSON.stringify(body)}`,
    );
  }
  return luhnCheckDigit(body);
}

/** True when `input` is a well-formed cedula with a correct check digit. */
export function isValidCedula(input: string): boolean {
  const compact = normalizeCedula(input);
  if (!new RegExp(`^\\d{${CEDULA_LENGTH}}$`).test(compact)) return false;
  return luhnIsValid(compact);
}
