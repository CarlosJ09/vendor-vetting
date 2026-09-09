/**
 * Structured-output schemas for classification and extraction.
 *
 * ## Everything comes back as a string
 *
 * Dates are returned exactly as printed (`03/08/2025`, `3 de agosto de 2025`),
 * not as ISO. Parsing them is the `normalize` stage's job, and it is
 * deterministic and unit-tested. Asking a 7B model to reformat a date is asking
 * it to do arithmetic it has no reason to get right, and it would destroy the
 * evidence of what the document actually said.
 *
 * ## The one exception is `estado`
 *
 * The compliance status is an enum the model must choose from prose, because
 * §4.2 makes that a deliberate technical problem: the wording varies and there
 * is no labelled field to transcribe. This is still reading, not judging — the
 * model says which of three things the document states, and code decides what
 * that implies for the dossier.
 *
 * ## Absent fields
 *
 * A missing field comes back as an empty string rather than null. JSON-Schema
 * nullability is handled inconsistently by small models, and an empty string is
 * unambiguous to normalise. `confidence` still says how sure the model is that
 * the field is genuinely absent.
 */

import { z } from "zod";

import { COMPLIANCE_STATUSES, DOCUMENT_TYPES } from "@/lib/domain/types";

/** A transcribed value with the model's confidence and the page it came from. */
const textField = z.object({
  value: z.string().describe("Exact text as printed, or an empty string if absent"),
  confidence: z.number().min(0).max(1).describe("Confidence in this value, 0 to 1"),
  page: z.number().int().min(1).describe("1-indexed page the value appears on"),
});

const statusField = z.object({
  value: z.enum(COMPLIANCE_STATUSES).describe("Status the document states"),
  confidence: z.number().min(0).max(1),
  page: z.number().int().min(1),
});

export const classificationSchema = z.object({
  type: z.enum([...DOCUMENT_TYPES, "unknown"]).describe("Document type, or unknown"),
  confidence: z.number().min(0).max(1),
});

export const registroMercantilSchema = z.object({
  rnc: textField,
  razon_social: textField,
  numero_registro: textField,
  fecha_emision: textField,
  fecha_vencimiento: textField,
  representante_legal: textField,
});

export const certificacionDgiiSchema = z.object({
  rnc: textField,
  razon_social: textField,
  estado: statusField,
  fecha_emision: textField,
  codigo_verificacion: textField,
});

export const certificacionTssSchema = z.object({
  rnc: textField,
  razon_social: textField,
  estado: statusField,
  fecha_emision: textField,
});

export const cedulaSchema = z.object({
  cedula: textField,
  nombre_completo: textField,
  fecha_nacimiento: textField,
  fecha_vencimiento: textField,
});

export const EXTRACTION_SCHEMAS = {
  registro_mercantil: registroMercantilSchema,
  certificacion_dgii: certificacionDgiiSchema,
  certificacion_tss: certificacionTssSchema,
  cedula: cedulaSchema,
} as const;

export type RawRegistroMercantil = z.infer<typeof registroMercantilSchema>;
export type RawCertificacionDgii = z.infer<typeof certificacionDgiiSchema>;
export type RawCertificacionTss = z.infer<typeof certificacionTssSchema>;
export type RawCedula = z.infer<typeof cedulaSchema>;

export type RawExtraction = {
  registro_mercantil: RawRegistroMercantil;
  certificacion_dgii: RawCertificacionDgii;
  certificacion_tss: RawCertificacionTss;
  cedula: RawCedula;
};

/**
 * Convert a zod schema to the JSON Schema the backend constrains generation with.
 *
 * `io: "input"` so the schema describes what the model must produce, before any
 * zod transforms are applied on our side.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
}
