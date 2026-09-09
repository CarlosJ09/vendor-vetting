import { describe, expect, it } from "vitest";

import { isValidCedula } from "@/lib/identifiers/cedula";
import { isValidRnc } from "@/lib/identifiers/rnc";

import {
  generateCedula,
  generateInvalidCedula,
  generateInvalidRnc,
  generateRnc,
} from "./identifiers";
import { createRng } from "./random";

describe("generateRnc", () => {
  it("always produces a checksum-valid RNC", () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      expect(isValidRnc(generateRnc(rng))).toBe(true);
    }
  });

  it("produces 9 digits", () => {
    const rng = createRng(2);
    expect(generateRnc(rng)).toMatch(/^\d{9}$/);
  });
});

describe("generateInvalidRnc", () => {
  it("always produces a checksum-invalid RNC", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      expect(isValidRnc(generateInvalidRnc(rng))).toBe(false);
    }
  });

  it("stays well-formed so the failure is the checksum, not the shape", () => {
    // A defect that is also malformed would be caught by the format check and
    // never exercise the check-digit path we mean to test.
    const rng = createRng(4);
    for (let i = 0; i < 100; i++) {
      expect(generateInvalidRnc(rng)).toMatch(/^\d{9}$/);
    }
  });
});

describe("generateCedula", () => {
  it("always produces a checksum-valid cedula", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      expect(isValidCedula(generateCedula(rng))).toBe(true);
    }
  });

  it("produces 11 digits", () => {
    const rng = createRng(6);
    expect(generateCedula(rng)).toMatch(/^\d{11}$/);
  });
});

describe("generateInvalidCedula", () => {
  it("always produces a checksum-invalid cedula", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      expect(isValidCedula(generateInvalidCedula(rng))).toBe(false);
    }
  });

  it("stays well-formed", () => {
    const rng = createRng(8);
    for (let i = 0; i < 100; i++) {
      expect(generateInvalidCedula(rng)).toMatch(/^\d{11}$/);
    }
  });
});

describe("reproducibility", () => {
  const twentyFrom = (seed: number) => {
    const rng = createRng(seed);
    return Array.from({ length: 20 }, () => generateRnc(rng));
  };

  it("yields identical output for identical seeds", () => {
    expect(twentyFrom(42)).toEqual(twentyFrom(42));
  });

  it("yields different output for different seeds", () => {
    expect(twentyFrom(1)).not.toEqual(twentyFrom(2));
  });
});
