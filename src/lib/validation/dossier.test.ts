import { describe, expect, it } from "vitest";

import { validateDossier } from "./dossier";
import { cleanDossier } from "./test-helpers";
import type { ExtractedDocument, RequirementKey } from "./types";

const REF = "2026-06-15";

const run = (documents: ExtractedDocument[], referenceDate = REF) =>
  validateDossier({ referenceDate, documents });

const statusOf = (documents: ExtractedDocument[], requirement: RequirementKey, ref = REF) =>
  run(documents, ref).requirements.find((r) => r.requirement === requirement)?.status;

const replace = (
  documents: ExtractedDocument[],
  type: ExtractedDocument["type"],
  mutate: (document: ExtractedDocument) => ExtractedDocument,
): ExtractedDocument[] => documents.map((d) => (d.type === type ? mutate(d) : d));

/** Overwrite one field's value while keeping the rest of its envelope. */
const setField = (document: ExtractedDocument, field: string, value: unknown): ExtractedDocument => {
  const fields = document.fields as unknown as Record<string, { value: unknown }>;
  return {
    ...document,
    fields: { ...fields, [field]: { ...fields[field], value } },
  } as ExtractedDocument;
};

/** Overwrite one field's confidence while keeping its value. */
const setConfidence = (
  document: ExtractedDocument,
  field: string,
  confidence: number,
): ExtractedDocument => {
  const fields = document.fields as unknown as Record<string, { confidence: number }>;
  return {
    ...document,
    fields: { ...fields, [field]: { ...fields[field], confidence } },
  } as ExtractedDocument;
};

describe("validateDossier — a clean dossier", () => {
  it("passes overall", () => {
    expect(run(cleanDossier()).overall).toBe("pass");
  });

  it("passes every individual requirement", () => {
    for (const requirement of run(cleanDossier()).requirements) {
      expect({ key: requirement.requirement, status: requirement.status }).toEqual({
        key: requirement.requirement,
        status: "pass",
      });
    }
  });

  it("leaves the review queue empty", () => {
    expect(run(cleanDossier()).reviewQueue).toEqual([]);
  });

  it("attaches evidence to the checks that have any", () => {
    const rnc = run(cleanDossier()).requirements.find((r) => r.requirement === "rnc_consistency");
    expect(rnc?.evidence.length).toBe(3);
    expect(rnc?.evidence.every((e) => e.field === "rnc")).toBe(true);
  });
});

describe("validateDossier — field-level defects", () => {
  it("fails an RNC with a bad check digit", () => {
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setField(d, "rnc", "101850042"),
    );
    expect(statusOf(documents, "registro_mercantil_rnc")).toBe("fail");
    expect(run(documents).overall).toBe("fail");
  });

  it("fails a cedula with a bad check digit", () => {
    const documents = replace(cleanDossier(), "cedula", (d) =>
      setField(d, "cedula", "00113918204"),
    );
    expect(statusOf(documents, "cedula_numero")).toBe("fail");
  });

  it("fails a DGII certification that is not al_dia", () => {
    for (const estado of ["con_deuda", "indeterminado"]) {
      const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
        setField(d, "estado", estado),
      );
      expect(statusOf(documents, "dgii_estado")).toBe("fail");
    }
  });

  it("fails an expired Registro Mercantil using its printed expiry", () => {
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setField(d, "fecha_vencimiento", "2026-05-01"),
    );
    expect(statusOf(documents, "registro_mercantil_vigencia")).toBe("fail");
  });

  it("fails a DGII certification outside its derived window", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "fecha_emision", "2026-01-01"),
    );
    expect(statusOf(documents, "dgii_vigencia")).toBe("fail");
  });

  it("warns on a certification about to lapse", () => {
    // Issued 2026-05-25, 30-day window, so it expires 2026-06-24 — 9 days out.
    const documents = replace(cleanDossier(), "certificacion_tss", (d) =>
      setField(d, "fecha_emision", "2026-05-25"),
    );
    expect(statusOf(documents, "tss_vigencia")).toBe("warn");
  });

  it("fails a certification issued in the future", () => {
    const documents = replace(cleanDossier(), "certificacion_tss", (d) =>
      setField(d, "fecha_emision", "2026-08-01"),
    );
    expect(statusOf(documents, "tss_vigencia")).toBe("fail");
  });

  it("fails a Registro Mercantil whose expiry precedes its issue date", () => {
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setField(d, "fecha_vencimiento", "2025-01-01"),
    );
    expect(statusOf(documents, "registro_mercantil_dates")).toBe("fail");
  });

  it("fails an expired cedula", () => {
    const documents = replace(cleanDossier(), "cedula", (d) =>
      setField(d, "fecha_vencimiento", "2025-01-01"),
    );
    expect(statusOf(documents, "cedula_vigencia")).toBe("fail");
  });
});

describe("validateDossier — cross-document coherence", () => {
  it("fails when the RNC differs across documents", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "rnc", "131246796"),
    );
    expect(statusOf(documents, "rnc_consistency")).toBe("fail");
  });

  it("accepts legal-form and casing variants of the same company", () => {
    let documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "razon_social", "CONSTRUCTORA DEL CARIBE SRL"),
    );
    documents = replace(documents, "certificacion_tss", (d) =>
      setField(d, "razon_social", "Constructora del Caribe S. R. L."),
    );
    expect(statusOf(documents, "razon_social_consistency")).toBe("pass");
  });

  it("warns on a near-miss company name rather than passing it silently", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "razon_social", "Constructora del Karibe SRL"),
    );
    expect(statusOf(documents, "razon_social_consistency")).toBe("warn");
  });

  it("fails an outright different company name", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "razon_social", "Inversiones Bella Vista, S.A."),
    );
    expect(statusOf(documents, "razon_social_consistency")).toBe("fail");
  });

  it("fails when the cedula names a different person", () => {
    const documents = replace(cleanDossier(), "cedula", (d) =>
      setField(d, "nombre_completo", "Ana Belkis Guzmán Reyes"),
    );
    expect(statusOf(documents, "representante_consistency")).toBe("fail");
  });

  it("matches the representative across accent differences", () => {
    const documents = replace(cleanDossier(), "cedula", (d) =>
      setField(d, "nombre_completo", "JOSE RAMIREZ PENA"),
    );
    expect(statusOf(documents, "representante_consistency")).toBe("pass");
  });

  it("warns when the cedula drops a middle name", () => {
    let documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setField(d, "representante_legal", "José Antonio Ramírez Peña"),
    );
    documents = replace(documents, "cedula", (d) =>
      setField(d, "nombre_completo", "José Ramírez Peña"),
    );
    expect(statusOf(documents, "representante_consistency")).toBe("warn");
  });
});

describe("validateDossier — structural defects", () => {
  it("fails completeness when a document is missing", () => {
    const documents = cleanDossier().filter((d) => d.type !== "certificacion_dgii");
    const report = run(documents);
    expect(report.requirements.find((r) => r.requirement === "completeness")?.status).toBe("fail");
    expect(report.overall).toBe("fail");
  });

  it("emits no requirements for a missing document instead of restating the absence", () => {
    const documents = cleanDossier().filter((d) => d.type !== "certificacion_dgii");
    const keys = run(documents).requirements.map((r) => r.requirement);
    expect(keys).not.toContain("dgii_estado");
    expect(keys).not.toContain("dgii_vigencia");
    expect(keys).not.toContain("dgii_rnc");
  });

  it("warns on a duplicated document without failing the dossier", () => {
    const base = cleanDossier();
    const duplicate = base.find((d) => d.type === "certificacion_tss")!;
    const report = run([...base, { ...duplicate, documentId: "copy", filename: "copia.pdf" }]);

    expect(report.requirements.find((r) => r.requirement === "no_duplicates")?.status).toBe("warn");
    expect(report.overall).toBe("warn");
  });
});

describe("validateDossier — confidence handling", () => {
  it("routes a low-confidence field to needs_review", () => {
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setConfidence(d, "rnc", 0.4),
    );
    expect(statusOf(documents, "registro_mercantil_rnc")).toBe("needs_review");
  });

  it("prefers needs_review over fail when the input itself is untrusted", () => {
    // A checksum computed over digits we are not confident we read does not
    // prove the document is bad — it proves we could not read it.
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setConfidence(setField(d, "rnc", "101850042"), "rnc", 0.3),
    );
    expect(statusOf(documents, "registro_mercantil_rnc")).toBe("needs_review");
  });

  it("lists low-confidence fields in the review queue", () => {
    const documents = replace(cleanDossier(), "cedula", (d) => setConfidence(d, "cedula", 0.2));

    const queue = run(documents).reviewQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].field).toBe("cedula");
  });

  it("never lets needs_review outrank a definite failure elsewhere", () => {
    let documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "estado", "con_deuda"),
    );
    documents = replace(documents, "cedula", (d) => setConfidence(d, "cedula", 0.2));

    expect(run(documents).overall).toBe("fail");
  });

  it("survives a field the model declined to answer", () => {
    // Regression: rules used to be evaluated before the confidence guard could
    // suppress them, so an abstained date ("" at confidence 0) reached the date
    // parser and threw, taking down validation for the entire dossier.
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setConfidence(setField(d, "fecha_emision", ""), "fecha_emision", 0),
    );

    expect(() => run(documents)).not.toThrow();
    expect(statusOf(documents, "registro_mercantil_dates")).toBe("needs_review");
  });

  it("survives an abstained date on an implicit-expiry certification", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setConfidence(setField(d, "fecha_emision", ""), "fecha_emision", 0),
    );

    expect(() => run(documents)).not.toThrow();
    expect(statusOf(documents, "dgii_vigencia")).toBe("needs_review");
  });

  it("treats an empty value as unusable even at high reported confidence", () => {
    // A model can be confidently wrong about having found nothing. An empty
    // string is not a value to run a rule against, whatever it claims.
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setConfidence(setField(d, "rnc", ""), "rnc", 0.99),
    );

    expect(statusOf(documents, "registro_mercantil_rnc")).toBe("needs_review");
  });

  it("respects a custom confidence threshold", () => {
    const documents = replace(cleanDossier(), "registro_mercantil", (d) =>
      setConfidence(d, "rnc", 0.6),
    );

    const strict = validateDossier({ referenceDate: REF, documents, config: { confidenceThreshold: 0.9 } });
    const lenient = validateDossier({ referenceDate: REF, documents, config: { confidenceThreshold: 0.5 } });

    expect(strict.requirements.find((r) => r.requirement === "registro_mercantil_rnc")?.status).toBe("needs_review");
    expect(lenient.requirements.find((r) => r.requirement === "registro_mercantil_rnc")?.status).toBe("pass");
  });
});

describe("validateDossier — configuration", () => {
  it("treats the validity window as configurable policy, not a baked-in rule", () => {
    const documents = replace(cleanDossier(), "certificacion_dgii", (d) =>
      setField(d, "fecha_emision", "2026-04-01"),
    );

    const short = validateDossier({ referenceDate: REF, documents });
    const long = validateDossier({
      referenceDate: REF,
      documents,
      config: { validityWindowDays: { certificacion_dgii: 365, certificacion_tss: 30 } },
    });

    expect(short.requirements.find((r) => r.requirement === "dgii_vigencia")?.status).toBe("fail");
    expect(long.requirements.find((r) => r.requirement === "dgii_vigencia")?.status).toBe("pass");
  });

  it("evaluates as of the reference date, not the wall clock", () => {
    // The same dossier is valid on one date and expired on another; nothing here
    // consults `new Date()`.
    const documents = cleanDossier();
    expect(validateDossier({ referenceDate: "2026-06-15", documents }).overall).toBe("pass");
    expect(
      validateDossier({ referenceDate: "2028-01-01", documents }).requirements.find(
        (r) => r.requirement === "registro_mercantil_vigencia",
      )?.status,
    ).toBe("fail");
  });
});
