import { describe, expect, it } from "vitest";

import {
  compareCompanyNames,
  comparePersonNames,
  normalizeCompanyName,
  normalizePersonName,
  similarity,
} from "./names";

describe("normalizeCompanyName", () => {
  it("folds case and whitespace", () => {
    expect(normalizeCompanyName("  Constructora   DEL Caribe  ")).toBe(
      "constructora del caribe",
    );
  });

  it("strips accents", () => {
    expect(normalizeCompanyName("Construcción Ñandú")).toBe("construccion nandu");
  });

  it("canonicalises the SRL suffix across punctuation variants", () => {
    const expected = "constructora del caribe";
    expect(normalizeCompanyName("Constructora del Caribe SRL")).toBe(expected);
    expect(normalizeCompanyName("Constructora del Caribe S.R.L.")).toBe(expected);
    expect(normalizeCompanyName("Constructora del Caribe, S. R. L.")).toBe(expected);
    expect(normalizeCompanyName("CONSTRUCTORA DEL CARIBE SRL.")).toBe(expected);
  });

  it("canonicalises the other Dominican legal forms", () => {
    expect(normalizeCompanyName("Inversiones Bella Vista S.A.")).toBe(
      "inversiones bella vista",
    );
    expect(normalizeCompanyName("Inversiones Bella Vista, C. por A.")).toBe(
      "inversiones bella vista",
    );
    expect(normalizeCompanyName("Servicios Integrales EIRL")).toBe(
      "servicios integrales",
    );
    expect(normalizeCompanyName("Tecnologia Aplicada S.A.S.")).toBe(
      "tecnologia aplicada",
    );
  });

  it("only strips a legal form at the end, not mid-name", () => {
    // "Sa" here is part of the name, not a suffix.
    expect(normalizeCompanyName("Grupo Sa Vida SRL")).toBe("grupo sa vida");
  });

  it("does not reduce a name to nothing", () => {
    // Degenerate input must not normalize to the empty string, or every such
    // document would spuriously "match" every other.
    expect(normalizeCompanyName("SRL")).not.toBe("");
  });
});

describe("normalizePersonName", () => {
  it("folds case, accents and whitespace", () => {
    expect(normalizePersonName("  José  RAMÍREZ  Peña ")).toBe("jose ramirez pena");
  });

  it("drops punctuation and honorifics", () => {
    expect(normalizePersonName("Lic. María Fernández")).toBe("maria fernandez");
    expect(normalizePersonName("Dr. Juan Pérez")).toBe("juan perez");
  });
});

describe("similarity", () => {
  it("is 1 for identical strings", () => {
    expect(similarity("abc", "abc")).toBe(1);
  });

  it("is 0 for entirely dissimilar strings", () => {
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("is 1 for two empty strings", () => {
    expect(similarity("", "")).toBe(1);
  });

  it("degrades gradually with edit distance", () => {
    const oneOff = similarity("constructora", "construcora");
    expect(oneOff).toBeGreaterThan(0.9);
    expect(oneOff).toBeLessThan(1);
  });

  it("is symmetric", () => {
    expect(similarity("caribe", "karibe")).toBe(similarity("karibe", "caribe"));
  });
});

describe("compareCompanyNames", () => {
  it("reports an exact match once normalized", () => {
    const result = compareCompanyNames(
      "Constructora del Caribe, S.R.L.",
      "CONSTRUCTORA DEL CARIBE SRL",
    );
    expect(result.verdict).toBe("match");
    expect(result.score).toBe(1);
  });

  it("reports a near-miss as a warning, never a silent pass", () => {
    const result = compareCompanyNames(
      "Constructora del Caribe SRL",
      "Constructora del Karibe SRL",
    );
    expect(result.verdict).toBe("near");
  });

  it("reports unrelated names as a mismatch", () => {
    const result = compareCompanyNames(
      "Constructora del Caribe SRL",
      "Inversiones Bella Vista SA",
    );
    expect(result.verdict).toBe("mismatch");
  });
});

describe("comparePersonNames", () => {
  it("matches the same person written with and without accents", () => {
    expect(comparePersonNames("José Ramírez Peña", "JOSE RAMIREZ PENA").verdict).toBe(
      "match",
    );
  });

  it("flags a different person as a mismatch", () => {
    expect(comparePersonNames("José Ramírez Peña", "Ana Belkis Guzmán").verdict).toBe(
      "mismatch",
    );
  });

  it("treats a dropped middle name as a near-miss needing review", () => {
    // Common and usually benign, but it is not the code's call to decide that.
    expect(comparePersonNames("José Antonio Ramírez", "José Ramírez").verdict).toBe(
      "near",
    );
  });
});
