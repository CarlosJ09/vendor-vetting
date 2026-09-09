/**
 * The variation axes the synthetic corpus is built to cover.
 *
 * Each constant here exists because some stage of the pipeline needs to be
 * exercised against it: the status phrasings stress the classifier's enum
 * mapping, the date scenarios stress the freshness rules, and the defect kinds
 * are what the eval's false-pass rate is measured against.
 */

import type { ComplianceStatus, DocumentType } from "@/lib/domain/types";

/**
 * Prose the certifications use to express compliance status.
 *
 * The model is asked which of these a document says — it is never asked whether
 * the company is compliant. The mapping from phrasing to enum is ground truth
 * held here in code, so the eval can score the classification honestly.
 *
 * The `indeterminado` phrasings are deliberately genuinely ambiguous. A payment
 * agreement covering outstanding debt is neither plainly current nor plainly
 * delinquent, and a system that confidently picks one is worse than one that
 * admits the document does not say.
 */
export const DGII_STATUS_PHRASINGS: Record<ComplianceStatus, readonly string[]> = {
  al_dia: [
    "se encuentra AL DÍA en el cumplimiento de sus obligaciones fiscales.",
    "está al día con sus obligaciones tributarias a la fecha de expedición de la presente certificación.",
    "no presenta obligaciones fiscales pendientes ante esta Dirección General.",
    "ha cumplido con la presentación y pago de sus declaraciones juradas.",
  ],
  con_deuda: [
    "presenta obligaciones fiscales pendientes de pago ante esta Dirección General.",
    "registra deuda pendiente por concepto de impuestos no liquidados.",
    "NO se encuentra al día en el cumplimiento de sus obligaciones fiscales.",
    "mantiene omisiones en la presentación de sus declaraciones juradas.",
  ],
  indeterminado: [
    "mantiene un acuerdo de pago vigente sobre obligaciones fiscales pendientes.",
    "se encuentra en proceso de revisión de su situación tributaria.",
    "su situación fiscal no pudo ser determinada al momento de la consulta.",
    "presenta obligaciones sujetas a recurso de reconsideración en trámite.",
  ],
};

export const TSS_STATUS_PHRASINGS: Record<ComplianceStatus, readonly string[]> = {
  al_dia: [
    "se encuentra AL DÍA en el pago de sus contribuciones a la Seguridad Social.",
    "está al día con sus aportes al Sistema Dominicano de Seguridad Social.",
    "no registra facturas pendientes de pago ante esta Tesorería.",
    "ha cumplido con el pago de las contribuciones correspondientes al período consultado.",
  ],
  con_deuda: [
    "presenta facturas vencidas pendientes de pago ante esta Tesorería.",
    "registra atrasos en el pago de sus contribuciones a la Seguridad Social.",
    "NO se encuentra al día en sus obligaciones con el Sistema Dominicano de Seguridad Social.",
    "mantiene deuda por concepto de aportes no liquidados.",
  ],
  indeterminado: [
    "mantiene un plan de pago vigente sobre facturas pendientes.",
    "se encuentra en proceso de conciliación de su estado de cuenta.",
    "su situación no pudo ser verificada al momento de la emisión.",
    "presenta novedades en trámite que afectan el estado de cuenta.",
  ],
};

/** How a document's dates sit relative to the dossier's reference date. */
export type DateScenario =
  | "fresh"
  | "near_expiry"
  | "expired"
  | "future_issue";

/** The ways a dossier can be defective. Drives the eval's failure analysis. */
export type DefectKind =
  | "invalid_rnc_check_digit"
  | "invalid_cedula_check_digit"
  | "rnc_mismatch"
  | "razon_social_mismatch"
  | "representante_mismatch"
  | "expired_document"
  | "future_issue_date"
  | "status_not_al_dia"
  | "missing_document"
  | "duplicate_document"
  | "expired_cedula";

export interface Defect {
  kind: DefectKind;
  /** Which document carries the defect, when it is localised to one. */
  documentType?: DocumentType;
  /** Human-readable description, reproduced in the ground-truth file. */
  detail: string;
}

/**
 * Defects that can be combined into one dossier.
 *
 * `missing_document` is excluded from pairing: a dossier missing a document has
 * nothing to cross-check against, which would make a second, coherence-based
 * defect unobservable rather than simply harder to catch.
 */
export const COMBINABLE_DEFECTS: readonly DefectKind[] = [
  "invalid_rnc_check_digit",
  "invalid_cedula_check_digit",
  "rnc_mismatch",
  "razon_social_mismatch",
  "representante_mismatch",
  "expired_document",
  "future_issue_date",
  "status_not_al_dia",
  "expired_cedula",
];
