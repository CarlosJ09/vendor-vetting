/**
 * Assembles a dossier verdict from the deterministic rules.
 *
 * This is the layer the whole project is meant to demonstrate (§3): every
 * judgement below is made by code against extracted values. The model supplied
 * the values and its confidence in them; it never supplied an opinion.
 *
 * ## Confidence beats every other verdict
 *
 * When a field feeding a requirement was extracted below the confidence
 * threshold, the requirement becomes `needs_review` — even if the rule would
 * otherwise have said `fail`. The reasoning is that a checksum computed over
 * digits we are not confident we read correctly does not establish that the
 * document is bad; it establishes that we could not read it. Routing that to a
 * human is not a false pass, and `needs_review` never counts as one.
 *
 * Rules are therefore passed to `emit` as thunks rather than as computed
 * values. Arguments are evaluated before a call, so a rule supplied eagerly
 * runs *before* any guard inside `emit` can suppress it — which meant a field
 * the model abstained on (an empty string, confidence 0) reached the date
 * parser and threw, taking down validation for the whole dossier. Laziness here
 * is load-bearing, not style.
 *
 * ## Missing documents
 *
 * Requirements belonging to an absent document are not emitted at all. A
 * dossier missing its DGII certification produces one honest `completeness`
 * failure rather than a wall of derived failures that all restate it.
 */

import {
  CONFIDENCE_THRESHOLD,
  EXPIRY_WARNING_DAYS,
  NAME_NEAR_MATCH_THRESHOLD,
  VALIDITY_WINDOW_DAYS,
} from "@/lib/config";
import type { PlainDate } from "@/lib/dates";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type Extracted,
  type RequirementStatus,
} from "@/lib/domain/types";
import { isValidCedula } from "@/lib/identifiers/cedula";
import { isValidRnc } from "@/lib/identifiers/rnc";

import {
  checkCompanyNames,
  checkPersonAgainstRepresentative,
  checkRncConsistency,
} from "./coherence";
import { checkDateSanity, evaluateExplicitExpiry, evaluateImplicitExpiry } from "./freshness";
import {
  REQUIREMENTS,
  evidenceFrom,
  type DossierReport,
  type Evidence,
  type ExtractedDocument,
  type RequirementKey,
  type RequirementOutcome,
} from "./types";

export interface ValidationConfig {
  validityWindowDays: Record<"certificacion_dgii" | "certificacion_tss", number>;
  expiryWarningDays: number;
  confidenceThreshold: number;
  nameNearMatchThreshold: number;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  validityWindowDays: VALIDITY_WINDOW_DAYS,
  expiryWarningDays: EXPIRY_WARNING_DAYS,
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  nameNearMatchThreshold: NAME_NEAR_MATCH_THRESHOLD,
};

export interface ValidateDossierInput {
  referenceDate: PlainDate;
  documents: ExtractedDocument[];
  config?: Partial<ValidationConfig>;
}

/** Severity ordering used to roll requirement outcomes up into one verdict. */
const SEVERITY: Record<RequirementStatus, number> = {
  pass: 0,
  warn: 1,
  needs_review: 2,
  fail: 3,
};

function worst(statuses: RequirementStatus[]): RequirementStatus {
  return statuses.reduce<RequirementStatus>(
    (acc, status) => (SEVERITY[status] > SEVERITY[acc] ? status : acc),
    "pass",
  );
}

type Contribution = {
  document: ExtractedDocument;
  field: string;
  extracted: Extracted<unknown>;
};

/** A rule's outcome, computed only once its inputs are known to be usable. */
type RuleOutcome = { status: RequirementStatus; detail: string };

export function validateDossier(input: ValidateDossierInput): DossierReport {
  const config = { ...DEFAULT_VALIDATION_CONFIG, ...input.config };
  const { referenceDate } = input;

  const outcomes: RequirementOutcome[] = [];
  const reviewQueue: Evidence[] = [];

  /**
   * Record a requirement.
   *
   * `rule` is a thunk so it never runs on values the system does not trust. See
   * the note at the top of this file: this is what stops an unreadable field
   * from reaching a parser.
   */
  const emit = (
    requirement: RequirementKey,
    contributing: Contribution[],
    rule: () => RuleOutcome,
  ): void => {
    const evidence = contributing.map(({ document, field, extracted }) =>
      evidenceFrom(document, field, extracted),
    );

    const unusable = contributing.filter(
      ({ extracted }) =>
        extracted.confidence < config.confidenceThreshold ||
        extracted.value === "" ||
        extracted.value === null ||
        extracted.value === undefined,
    );

    if (unusable.length > 0) {
      const names = [...new Set(unusable.map((c) => c.field))].join(", ");
      outcomes.push({
        requirement,
        label: REQUIREMENTS[requirement],
        status: "needs_review",
        detail: `Confianza insuficiente para decidir (${names}). Requiere revisión humana.`,
        evidence,
      });
      return;
    }

    const { status, detail } = rule();
    outcomes.push({ requirement, label: REQUIREMENTS[requirement], status, detail, evidence });
  };

  const checksumRule = (value: string, kind: "rnc" | "cedula") => (): RuleOutcome => {
    const valid = kind === "rnc" ? isValidRnc(value) : isValidCedula(value);
    const label = kind === "rnc" ? "RNC" : "Cédula";
    return {
      status: valid ? "pass" : "fail",
      detail: valid
        ? `${label} ${value} supera la verificación de dígito.`
        : `${label} ${value} no supera la verificación de dígito.`,
    };
  };

  const statusRule = (value: string, subject: string) => (): RuleOutcome => ({
    status: value === "al_dia" ? "pass" : "fail",
    detail:
      value === "al_dia"
        ? `La certificación declara ${subject} al día.`
        : `La certificación declara estado "${value}", distinto de al_dia.`,
  });

  /* ---------------------------------------------------------- completeness -- */

  const byType = new Map<DocumentType, ExtractedDocument[]>();
  for (const document of input.documents) {
    byType.set(document.type, [...(byType.get(document.type) ?? []), document]);
  }

  const missing = DOCUMENT_TYPES.filter((type) => !byType.has(type));

  outcomes.push({
    requirement: "completeness",
    label: REQUIREMENTS.completeness,
    status: missing.length === 0 ? "pass" : "fail",
    detail:
      missing.length === 0
        ? "Los cuatro documentos requeridos están presentes."
        : `Faltan ${missing.length} documento(s): ${missing.map((t) => DOCUMENT_TYPE_LABELS[t]).join(", ")}.`,
    evidence: [],
  });

  const duplicated = [...byType.entries()].filter(([, docs]) => docs.length > 1);

  outcomes.push({
    requirement: "no_duplicates",
    label: REQUIREMENTS.no_duplicates,
    // A duplicate is a packaging problem, not a compliance failure: the
    // underlying document may be perfectly valid, so it warns rather than fails.
    status: duplicated.length === 0 ? "pass" : "warn",
    detail:
      duplicated.length === 0
        ? "No se detectaron documentos duplicados."
        : duplicated
            .map(
              ([type, docs]) =>
                `${DOCUMENT_TYPE_LABELS[type]} aparece ${docs.length} veces (${docs.map((d) => d.filename).join(", ")}).`,
            )
            .join(" "),
    evidence: [],
  });

  // Where a type is duplicated, the first occurrence is treated as canonical.
  const registro = byType.get("registro_mercantil")?.[0];
  const dgii = byType.get("certificacion_dgii")?.[0];
  const tss = byType.get("certificacion_tss")?.[0];
  const cedula = byType.get("cedula")?.[0];

  /* --------------------------------------------------- Registro Mercantil -- */

  if (registro?.type === "registro_mercantil") {
    const f = registro.fields;

    emit(
      "registro_mercantil_rnc",
      [{ document: registro, field: "rnc", extracted: f.rnc }],
      checksumRule(f.rnc.value, "rnc"),
    );

    emit(
      "registro_mercantil_dates",
      [
        { document: registro, field: "fecha_emision", extracted: f.fecha_emision },
        { document: registro, field: "fecha_vencimiento", extracted: f.fecha_vencimiento },
      ],
      () => {
        const sanity = checkDateSanity({
          issued: f.fecha_emision.value,
          expires: f.fecha_vencimiento.value,
          reference: referenceDate,
        });
        return {
          status: sanity.ok ? "pass" : "fail",
          detail: sanity.ok
            ? "Fechas de emisión y vencimiento coherentes."
            : `Problemas de fechas: ${sanity.problems.join(", ")}.`,
        };
      },
    );

    emit(
      "registro_mercantil_vigencia",
      [{ document: registro, field: "fecha_vencimiento", extracted: f.fecha_vencimiento }],
      () => {
        const expiry = evaluateExplicitExpiry(
          f.fecha_vencimiento.value,
          referenceDate,
          config.expiryWarningDays,
        );
        return {
          status: expiry.status,
          detail: describeExpiry(
            expiry.status,
            expiry.daysRemaining,
            expiry.expiryDate,
            "impresa en el documento",
          ),
        };
      },
    );
  }

  /* ------------------------------------------------------------------ DGII -- */

  if (dgii?.type === "certificacion_dgii") {
    const f = dgii.fields;

    emit(
      "dgii_rnc",
      [{ document: dgii, field: "rnc", extracted: f.rnc }],
      checksumRule(f.rnc.value, "rnc"),
    );

    emit(
      "dgii_estado",
      [{ document: dgii, field: "estado", extracted: f.estado }],
      statusRule(f.estado.value, "al contribuyente"),
    );

    emitImplicitFreshness(dgii, "dgii_vigencia", "certificacion_dgii");
  }

  /* ------------------------------------------------------------------- TSS -- */

  if (tss?.type === "certificacion_tss") {
    const f = tss.fields;

    emit(
      "tss_rnc",
      [{ document: tss, field: "rnc", extracted: f.rnc }],
      checksumRule(f.rnc.value, "rnc"),
    );

    emit(
      "tss_estado",
      [{ document: tss, field: "estado", extracted: f.estado }],
      statusRule(f.estado.value, "al empleador"),
    );

    emitImplicitFreshness(tss, "tss_vigencia", "certificacion_tss");
  }

  /* ---------------------------------------------------------------- cédula -- */

  if (cedula?.type === "cedula") {
    const f = cedula.fields;

    emit(
      "cedula_numero",
      [{ document: cedula, field: "cedula", extracted: f.cedula }],
      checksumRule(f.cedula.value, "cedula"),
    );

    emit(
      "cedula_vigencia",
      [{ document: cedula, field: "fecha_vencimiento", extracted: f.fecha_vencimiento }],
      () => {
        const expiry = evaluateExplicitExpiry(
          f.fecha_vencimiento.value,
          referenceDate,
          config.expiryWarningDays,
        );
        return {
          status: expiry.status,
          detail: describeExpiry(
            expiry.status,
            expiry.daysRemaining,
            expiry.expiryDate,
            "impresa en la cédula",
          ),
        };
      },
    );
  }

  /* ------------------------------------------------------------- coherence -- */

  const certifications = [registro, dgii, tss].filter(
    (d): d is ExtractedDocument => d !== undefined,
  );

  if (certifications.length >= 2) {
    const rncCheck = checkRncConsistency(certifications);
    emit("rnc_consistency", rncCheck.contributing, () => ({
      status: rncCheck.status,
      detail: rncCheck.detail,
    }));

    const nameCheck = checkCompanyNames(certifications, config.nameNearMatchThreshold);
    emit("razon_social_consistency", nameCheck.contributing, () => ({
      status: nameCheck.status,
      detail: nameCheck.detail,
    }));
  }

  if (registro?.type === "registro_mercantil" && cedula?.type === "cedula") {
    const check = checkPersonAgainstRepresentative(registro, cedula, config.nameNearMatchThreshold);
    emit("representante_consistency", check.contributing, () => ({
      status: check.status,
      detail: check.detail,
    }));
  }

  /* ----------------------------------------------------------- review queue -- */

  for (const document of input.documents) {
    for (const [field, value] of Object.entries(document.fields) as [string, Extracted<unknown>][]) {
      if (value.confidence < config.confidenceThreshold) {
        reviewQueue.push(evidenceFrom(document, field, value));
      }
    }
  }

  return {
    referenceDate,
    overall: worst(outcomes.map((o) => o.status)),
    requirements: outcomes,
    reviewQueue,
  };

  /* ------------------------------------------------------------- internals -- */

  function emitImplicitFreshness(
    document: ExtractedDocument,
    requirement: RequirementKey,
    type: "certificacion_dgii" | "certificacion_tss",
  ): void {
    if (document.type !== "certificacion_dgii" && document.type !== "certificacion_tss") return;

    const issued = document.fields.fecha_emision;
    const windowDays = config.validityWindowDays[type];

    emit(requirement, [{ document, field: "fecha_emision", extracted: issued }], () => {
      const sanity = checkDateSanity({ issued: issued.value, reference: referenceDate });
      if (!sanity.ok) {
        return {
          status: "fail",
          detail: `Fecha de emisión ${issued.value} posterior a la fecha de evaluación ${referenceDate}.`,
        };
      }

      const expiry = evaluateImplicitExpiry(
        issued.value,
        windowDays,
        referenceDate,
        config.expiryWarningDays,
      );

      return {
        status: expiry.status,
        detail: describeExpiry(
          expiry.status,
          expiry.daysRemaining,
          expiry.expiryDate,
          `derivada de la emisión ${issued.value} más ${windowDays} días`,
        ),
      };
    });
  }
}

function describeExpiry(
  status: RequirementStatus,
  daysRemaining: number,
  expiryDate: PlainDate,
  source: string,
): string {
  if (status === "fail") {
    return `Vencida el ${expiryDate} (${Math.abs(daysRemaining)} días atrás), ${source}.`;
  }
  if (status === "warn") {
    return `Vence el ${expiryDate}, en ${daysRemaining} día(s), ${source}.`;
  }
  return `Vigente hasta el ${expiryDate} (${daysRemaining} días), ${source}.`;
}
