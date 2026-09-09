/**
 * Shapes the validation layer consumes and produces.
 *
 * The input is deliberately the *extraction* shape — every value wrapped in its
 * confidence and citation — rather than plain fields. Validation has to be able
 * to say "I could not read this well enough to judge it", and it can only do
 * that if confidence reaches it.
 */

import type {
  BBox,
  DocumentType,
  Extracted,
  FieldsFor,
  RequirementStatus,
} from "@/lib/domain/types";
import type { PlainDate } from "@/lib/dates";

/** Every field of a document type, each wrapped in its extraction envelope. */
export type ExtractedFields<T extends DocumentType> = {
  [K in keyof FieldsFor<T>]: Extracted<FieldsFor<T>[K]>;
};

export interface ExtractedDocumentBase {
  /** Identifier of the stored document this came from. */
  documentId: string;
  filename: string;
}

export type ExtractedDocument =
  | (ExtractedDocumentBase & {
      type: "registro_mercantil";
      fields: ExtractedFields<"registro_mercantil">;
    })
  | (ExtractedDocumentBase & {
      type: "certificacion_dgii";
      fields: ExtractedFields<"certificacion_dgii">;
    })
  | (ExtractedDocumentBase & {
      type: "certificacion_tss";
      fields: ExtractedFields<"certificacion_tss">;
    })
  | (ExtractedDocumentBase & {
      type: "cedula";
      fields: ExtractedFields<"cedula">;
    });

/** A pointer back to the exact value that justifies a verdict. */
export interface Evidence {
  documentId: string;
  filename: string;
  documentType: DocumentType;
  field: string;
  value: string;
  page: number | null;
  bbox: BBox | null;
}

/** Stable keys for the requirements shown in the dossier. */
export const REQUIREMENTS = {
  completeness: "Todos los documentos requeridos presentes",
  no_duplicates: "Sin documentos duplicados",

  registro_mercantil_rnc: "RNC válido en el Registro Mercantil",
  registro_mercantil_dates: "Fechas coherentes en el Registro Mercantil",
  registro_mercantil_vigencia: "Registro Mercantil vigente",

  dgii_rnc: "RNC válido en la certificación DGII",
  dgii_estado: "Situación fiscal al día",
  dgii_vigencia: "Certificación DGII vigente",

  tss_rnc: "RNC válido en la certificación TSS",
  tss_estado: "Situación de seguridad social al día",
  tss_vigencia: "Certificación TSS vigente",

  cedula_numero: "Cédula del representante válida",
  cedula_vigencia: "Cédula del representante vigente",

  rnc_consistency: "RNC coincide entre documentos",
  razon_social_consistency: "Razón social coincide entre documentos",
  representante_consistency: "Representante legal coincide con la cédula",
} as const;

export type RequirementKey = keyof typeof REQUIREMENTS;

export interface RequirementOutcome {
  requirement: RequirementKey;
  label: string;
  status: RequirementStatus;
  /** Explanation produced by code. Never model-generated. */
  detail: string;
  evidence: Evidence[];
}

export interface DossierReport {
  referenceDate: PlainDate;
  overall: RequirementStatus;
  requirements: RequirementOutcome[];
  /** Fields that fell below the confidence threshold, for the review queue. */
  reviewQueue: Evidence[];
}

/** Build an `Evidence` entry from a document and one of its extracted fields. */
export function evidenceFrom(
  document: ExtractedDocument,
  field: string,
  extracted: Extracted<unknown>,
): Evidence {
  return {
    documentId: document.documentId,
    filename: document.filename,
    documentType: document.type,
    field,
    value: String(extracted.value),
    page: extracted.page ?? null,
    bbox: extracted.bbox ?? null,
  };
}
