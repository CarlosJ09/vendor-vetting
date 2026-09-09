/**
 * Luhn (ISO/IEC 7812-1 "modulus 10") checksum.
 *
 * Shared because the cedula uses it directly. Kept separate from `cedula.ts`
 * so the generic algorithm can be tested and reasoned about on its own.
 */

/**
 * Sum of a digit string under the Luhn weighting: starting from the rightmost
 * character, every second digit is doubled and digits above 9 have 9 subtracted
 * (equivalent to summing their decimal digits).
 *
 * The caller is responsible for guaranteeing `digits` contains only 0-9.
 */
export function luhnSum(digits: string): number {
  let sum = 0;

  for (let i = 0; i < digits.length; i++) {
    // Position from the right, 1-indexed: the rightmost digit is position 1.
    const fromRight = digits.length - i;
    const value = digits.charCodeAt(i) - 48;
    const doubled = fromRight % 2 === 0 ? value * 2 : value;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }

  return sum;
}

/** True when `digits` (payload plus its trailing check digit) satisfies Luhn. */
export function luhnIsValid(digits: string): boolean {
  return luhnSum(digits) % 10 === 0;
}

/** The check digit that makes `body` (payload without check digit) valid. */
export function luhnCheckDigit(body: string): string {
  // Appending a placeholder shifts every payload digit into the parity it will
  // have in the final number, so the weighting matches `luhnIsValid`.
  const sum = luhnSum(body + "0");
  return String((10 - (sum % 10)) % 10);
}
