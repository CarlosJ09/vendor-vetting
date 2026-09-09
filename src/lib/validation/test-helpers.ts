/**
 * Builders for validation tests.
 *
 * Not a `.test.ts` file so vitest does not collect it as a suite. Its only job
 * is to spare every test from spelling out the `{ value, confidence, page }`
 * envelope around each field.
 */

import type { DocumentType, Extracted, FieldsFor } from "@/lib/domain/types";

import type { ExtractedDocument } from "./types";

export function extracted<T>(value: T, confidence = 1, page = 1): Extracted<T> {
  return { value, confidence, page };
}

let counter = 0;

/**
 * Wrap a plain field record into an `ExtractedDocument`.
 *
 * `confidence` applies to every field; `fieldConfidence` overrides individual
 * ones, which is how the review-queue tests target a single low-confidence field.
 */
export function makeDocument<T extends DocumentType>(
  type: T,
  fields: FieldsFor<T>,
  options: {
    documentId?: string;
    filename?: string;
    confidence?: number;
    fieldConfidence?: Partial<Record<keyof FieldsFor<T>, number>>;
  } = {},
): ExtractedDocument {
  const base = options.confidence ?? 1;
  const overrides = (options.fieldConfidence ?? {}) as Record<string, number>;

  const wrapped = Object.fromEntries(
    Object.entries(fields as unknown as Record<string, unknown>).map(([key, value]) => [
      key,
      extracted(value, overrides[key] ?? base),
    ]),
  );

  counter += 1;

  return {
    type,
    documentId: options.documentId ?? `doc-${counter}`,
    filename: options.filename ?? `archivo-${counter}.pdf`,
    fields: wrapped,
  } as ExtractedDocument;
}

/** A coherent, entirely clean set of four documents, as a starting point. */
export function cleanDossier(overrides: {
  rnc?: string;
  razonSocial?: string;
  representante?: string;
  cedula?: string;
  referenceDate?: string;
} = {}): ExtractedDocument[] {
  const rnc = overrides.rnc ?? "101850043";
  const razonSocial = overrides.razonSocial ?? "Constructora del Caribe, S.R.L.";
  const representante = overrides.representante ?? "José Ramírez Peña";
  const cedula = overrides.cedula ?? "00113918205";

  return [
    makeDocument("registro_mercantil", {
      rnc,
      razon_social: razonSocial,
      numero_registro: "404749",
      fecha_emision: "2026-01-10",
      fecha_vencimiento: "2027-01-10",
      representante_legal: representante,
    }),
    makeDocument("certificacion_dgii", {
      rnc,
      razon_social: razonSocial,
      estado: "al_dia",
      fecha_emision: "2026-06-10",
      codigo_verificacion: "ABCDEFGHJK",
    }),
    makeDocument("certificacion_tss", {
      rnc,
      razon_social: razonSocial,
      estado: "al_dia",
      fecha_emision: "2026-06-10",
    }),
    makeDocument("cedula", {
      cedula,
      nombre_completo: representante,
      fecha_nacimiento: "1985-04-12",
      fecha_vencimiento: "2030-01-01",
    }),
  ];
}
