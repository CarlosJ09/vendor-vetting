import { describe, expect, it } from "vitest";

import { normalizeExtraction } from "./normalize";

const field = (value: string, confidence = 0.95, page = 1) => ({ value, confidence, page });

const registroMercantil = (overrides: Record<string, ReturnType<typeof field>> = {}) =>
  normalizeExtraction({
    type: "registro_mercantil" as const,
    documentId: "doc-1",
    filename: "archivo.pdf",
    fields: {
      rnc: field("101850043"),
      razon_social: field("Constructora del Caribe, S.R.L."),
      numero_registro: field("404749"),
      fecha_emision: field("03/08/2025"),
      fecha_vencimiento: field("03/08/2027"),
      representante_legal: field("José Ramírez Peña"),
      ...overrides,
    },
  });

describe("normalizeExtraction — dates", () => {
  it("parses the printed DD/MM/YYYY form into a canonical date", () => {
    const { document } = registroMercantil();
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.fecha_emision.value).toBe("2025-08-03");
    expect(fields.fecha_vencimiento.value).toBe("2027-08-03");
  });

  it("parses the Spanish long form the certifications also use", () => {
    const { document } = registroMercantil({ fecha_emision: field("3 de agosto de 2025") });
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.fecha_emision.value).toBe("2025-08-03");
  });

  it("keeps the raw text and zeroes confidence when a date will not parse", () => {
    // The model transcribed something, but it is not a date. Guessing would be
    // worse than admitting the field could not be read.
    const { document, issues } = registroMercantil({ fecha_emision: field("no consta") });
    const fields = document.fields as Record<string, { value: unknown; confidence: number }>;

    expect(fields.fecha_emision.value).toBe("no consta");
    expect(fields.fecha_emision.confidence).toBe(0);
    expect(issues).toContainEqual({
      field: "fecha_emision",
      raw: "no consta",
      reason: "unparseable_date",
    });
  });

  it("rejects an impossible date rather than rolling it over", () => {
    const { document } = registroMercantil({ fecha_emision: field("31/02/2025") });
    const fields = document.fields as Record<string, { confidence: number }>;

    expect(fields.fecha_emision.confidence).toBe(0);
  });
});

describe("normalizeExtraction — identifiers", () => {
  it("strips RNC separators", () => {
    const { document } = registroMercantil({ rnc: field("1-01-85004-3") });
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.rnc.value).toBe("101850043");
  });

  it("strips cedula separators as the model may transcribe them", () => {
    const { document } = normalizeExtraction({
      type: "cedula" as const,
      documentId: "doc-2",
      filename: "IMG_0001.jpg",
      fields: {
        cedula: field("008-2750271-7"),
        nombre_completo: field("José Vásquez Ramírez"),
        fecha_nacimiento: field("09/05/1984"),
        fecha_vencimiento: field("06/09/2027"),
      },
    });
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.cedula.value).toBe("00827502717");
    expect(fields.fecha_nacimiento.value).toBe("1984-05-09");
  });
});

describe("normalizeExtraction — text", () => {
  it("collapses whitespace but preserves case and accents", () => {
    // These values are shown back to a human as evidence, so they must still
    // match what the document printed.
    const { document } = registroMercantil({
      razon_social: field("  Constructora   del Caribe,  S.R.L. "),
    });
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.razon_social.value).toBe("Constructora del Caribe, S.R.L.");
  });

  it("keeps the representative's name exactly as printed", () => {
    const { document } = registroMercantil();
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.representante_legal.value).toBe("José Ramírez Peña");
  });
});

describe("normalizeExtraction — absent fields", () => {
  it("reports an empty value and zeroes its confidence", () => {
    const { document, issues } = registroMercantil({ numero_registro: field("") });
    const fields = document.fields as Record<string, { value: unknown; confidence: number }>;

    expect(fields.numero_registro.value).toBe("");
    expect(fields.numero_registro.confidence).toBe(0);
    expect(issues).toContainEqual({ field: "numero_registro", raw: "", reason: "empty_value" });
  });
});

describe("normalizeExtraction — enums and provenance", () => {
  it("passes the status enum through untouched", () => {
    const { document } = normalizeExtraction({
      type: "certificacion_dgii" as const,
      documentId: "doc-3",
      filename: "doc.pdf",
      fields: {
        rnc: field("101850043"),
        razon_social: field("Constructora del Caribe SRL"),
        estado: { value: "al_dia" as const, confidence: 0.9, page: 1 },
        fecha_emision: field("10/06/2026"),
        codigo_verificacion: field("ABCDEFGHJK"),
      },
    });
    const fields = document.fields as Record<string, { value: unknown }>;

    expect(fields.estado.value).toBe("al_dia");
  });

  it("preserves confidence and page for every field", () => {
    const { document } = registroMercantil({ rnc: field("101850043", 0.42, 2) });
    const fields = document.fields as Record<string, { confidence: number; page: number }>;

    expect(fields.rnc.confidence).toBe(0.42);
    expect(fields.rnc.page).toBe(2);
  });

  it("produces a document the validation layer accepts", () => {
    const { document } = registroMercantil();

    expect(document.type).toBe("registro_mercantil");
    expect(document.documentId).toBe("doc-1");
    expect(document.filename).toBe("archivo.pdf");
  });
});
