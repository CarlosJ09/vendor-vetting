import { describe, expect, it } from "vitest";

import { calcRncCheckDigit, isValidRnc, normalizeRnc } from "./rnc";

/**
 * Test vectors are taken from published reference implementations, never from
 * our own code — a self-generated fixture would only prove the implementation
 * agrees with itself.
 *
 * Sources:
 *   - python-stdnum `stdnum/do/rnc.py` doctests (arthurdejong/python-stdnum)
 *   - gist gregorypilar/a2423d860f302ea156de2d0a69eba699
 *
 * The two sources express the remainder mapping differently — `(10 - r) % 9 + 1`
 * versus `r == 0 -> 2, r == 1 -> 1, else 11 - r` — and agree on all 11 residues.
 * `agrees with the alternate mapping` below pins that equivalence.
 */

describe("normalizeRnc", () => {
  it("strips the conventional 1-01-85004-3 separators", () => {
    expect(normalizeRnc("1-01-85004-3")).toBe("101850043");
  });

  it("strips whitespace", () => {
    expect(normalizeRnc(" 101 850 043 ")).toBe("101850043");
  });

  it("leaves an already-compact number untouched", () => {
    expect(normalizeRnc("101850043")).toBe("101850043");
  });
});

describe("calcRncCheckDigit", () => {
  it("derives 3 for 10185004", () => {
    expect(calcRncCheckDigit("10185004")).toBe("3");
  });

  it("derives 6 for 13124679", () => {
    expect(calcRncCheckDigit("13124679")).toBe("6");
  });

  it("rejects a body that is not exactly 8 digits", () => {
    expect(() => calcRncCheckDigit("1018500")).toThrow();
    expect(() => calcRncCheckDigit("101850043")).toThrow();
  });

  it("agrees with the alternate mapping across every residue", () => {
    // Independently restate the gist's mapping and require it to match ours for
    // every reachable remainder, so a refactor of either form gets caught.
    const alternate = (r: number) => (r === 0 ? 2 : r === 1 ? 1 : 11 - r);
    const weights = [7, 9, 8, 6, 5, 4, 3, 2];

    for (let n = 0; n < 3000; n++) {
      const body = String(n).padStart(8, "0");
      const remainder =
        body
          .split("")
          .reduce((acc, d, i) => acc + Number(d) * weights[i], 0) % 11;
      expect(calcRncCheckDigit(body)).toBe(String(alternate(remainder)));
    }
  });
});

describe("isValidRnc", () => {
  it("accepts published valid RNCs", () => {
    expect(isValidRnc("101850043")).toBe(true);
    expect(isValidRnc("131246796")).toBe(true);
  });

  it("accepts a valid RNC in separated form", () => {
    expect(isValidRnc("1-01-85004-3")).toBe(true);
    expect(isValidRnc("1-31-24679-6")).toBe(true);
  });

  it("rejects a transposed check digit", () => {
    expect(isValidRnc("101850042")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidRnc("1018A0043")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(isValidRnc("10185004")).toBe(false);
    expect(isValidRnc("1018500433")).toBe(false);
    expect(isValidRnc("")).toBe(false);
  });
});
