import { describe, expect, it } from "vitest";

import { calcCedulaCheckDigit, isValidCedula, normalizeCedula } from "./cedula";

/**
 * Test vectors from published reference implementations, not from our own code.
 *
 * Sources:
 *   - python-stdnum `stdnum/do/cedula.py` doctests (arthurdejong/python-stdnum),
 *     which delegates to `stdnum.luhn`
 *   - hminaya/SDQ and sebasjoa/Valida-cedula-dominicana, which independently
 *     describe the same modulus-10 / Luhn construction
 */

describe("normalizeCedula", () => {
  it("strips the conventional 001-1391820-5 separators", () => {
    expect(normalizeCedula("001-1391820-5")).toBe("00113918205");
  });

  it("preserves leading zeros", () => {
    expect(normalizeCedula("00113918205")).toBe("00113918205");
  });
});

describe("calcCedulaCheckDigit", () => {
  it("derives 5 for 0011391820", () => {
    expect(calcCedulaCheckDigit("0011391820")).toBe("5");
  });

  it("rejects a body that is not exactly 10 digits", () => {
    expect(() => calcCedulaCheckDigit("001139182")).toThrow();
    expect(() => calcCedulaCheckDigit("00113918205")).toThrow();
  });
});

describe("isValidCedula", () => {
  it("accepts a published valid cedula", () => {
    expect(isValidCedula("00113918205")).toBe(true);
  });

  it("accepts a valid cedula in separated form", () => {
    expect(isValidCedula("001-1391820-5")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidCedula("00113918204")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidCedula("0011391820A")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(isValidCedula("0011391820")).toBe(false);
    expect(isValidCedula("001139182055")).toBe(false);
    expect(isValidCedula("")).toBe(false);
  });

  it("catches every single-digit corruption of a valid cedula", () => {
    // Luhn is guaranteed to detect any single-digit substitution.
    const valid = "00113918205";
    for (let pos = 0; pos < valid.length; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === valid[pos]) continue;
        const corrupted = valid.slice(0, pos) + d + valid.slice(pos + 1);
        expect(isValidCedula(corrupted)).toBe(false);
      }
    }
  });
});
