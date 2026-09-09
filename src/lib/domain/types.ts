/**
 * Shared domain vocabulary for the vetting pipeline.
 *
 * These types are the contract between stages: the synthetic generator produces
 * them as ground truth, the extractor produces them from real files, and the
 * evaluation harness compares the two. Keeping one definition for both is what
 * makes the eval meaningful.
 */

import type { PlainDate } from "@/lib/dates";

export const DOCUMENT_TYPES = [
  "registro_mercantil",
  "certificacion_dgii",
  "certificacion_tss",
  "cedula",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** What the classifier may return: a known type, or an explicit refusal. */
export type ClassifiedType = DocumentType | "unknown";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  registro_mercantil: "Certificación de Registro Mercantil",
  certificacion_dgii: "Certificación de cumplimiento fiscal (DGII)",
  certificacion_tss: "Certificación de la TSS",
  cedula: "Cédula del representante legal",
};

/**
 * Compliance status as printed on the DGII and TSS certifications.
 *
 * `indeterminado` is a first-class outcome, not an error: some certifications
 * are worded ambiguously, and forcing the model to guess between `al_dia` and
 * `con_deuda` would manufacture confidence the document does not support.
 */
export const COMPLIANCE_STATUSES = ["al_dia", "con_deuda", "indeterminado"] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Region of a page, in normalized `[0, 1]` coordinates with the origin top-left. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A single extracted value together with the evidence supporting it.
 *
 * Every field the model reports carries this envelope. `confidence` drives the
 * review queue; `page` and `bbox` drive the evidence links in the dossier. A
 * bare value with no provenance is never accepted from the model.
 */
export interface Extracted<T> {
  value: T;
  /** Model-reported confidence in `[0, 1]`. */
  confidence: number;
  /** 1-indexed page the value was read from. */
  page: number;
  bbox?: BBox;
}

export interface RegistroMercantilFields {
  rnc: string;
  razon_social: string;
  numero_registro: string;
  fecha_emision: PlainDate;
  /** Printed on the document itself, unlike the DGII/TSS certifications. */
  fecha_vencimiento: PlainDate;
  representante_legal: string;
}

export interface CertificacionDgiiFields {
  rnc: string;
  razon_social: string;
  estado: ComplianceStatus;
  fecha_emision: PlainDate;
  codigo_verificacion: string;
}

export interface CertificacionTssFields {
  rnc: string;
  razon_social: string;
  estado: ComplianceStatus;
  fecha_emision: PlainDate;
}

export interface CedulaFields {
  cedula: string;
  nombre_completo: string;
  /** Extracted for completeness but never rendered in the dossier UI. */
  fecha_nacimiento: PlainDate;
  fecha_vencimiento: PlainDate;
}

/** Field payload keyed by document type. */
export interface FieldsByType {
  registro_mercantil: RegistroMercantilFields;
  certificacion_dgii: CertificacionDgiiFields;
  certificacion_tss: CertificacionTssFields;
  cedula: CedulaFields;
}

export type FieldsFor<T extends DocumentType> = FieldsByType[T];

/** Per-requirement outcome shown in the dossier. */
export type RequirementStatus = "pass" | "warn" | "fail" | "needs_review";
