/**
 * Cross-document coherence checks.
 *
 * These are the checks that make a folder of documents a *dossier* rather than
 * four unrelated files. Each returns a status plus the contributing fields, so
 * the caller can attach evidence and apply the confidence rule uniformly.
 *
 * Company names are compared after normalisation (case, accents, whitespace,
 * legal form). A difference that survives normalisation but stays above the
 * similarity threshold is reported as `warn`, never as a pass: §5 is explicit
 * that near-misses must surface rather than be absorbed.
 */

import { compareCompanyNames, comparePersonNames, similarity } from "@/lib/names";
import { normalizeCompanyName, normalizePersonName } from "@/lib/names";
import type { Extracted, RequirementStatus } from "@/lib/domain/types";

import type { ExtractedDocument } from "./types";

export interface CoherenceCheck {
  status: RequirementStatus;
  detail: string;
  contributing: { document: ExtractedDocument; field: string; extracted: Extracted<unknown> }[];
}

/** Documents that carry an `rnc` and a `razon_social`. */
type CertificationDocument = Extract<
  ExtractedDocument,
  { type: "registro_mercantil" | "certificacion_dgii" | "certificacion_tss" }
>;

function certificationsOnly(documents: ExtractedDocument[]): CertificationDocument[] {
  return documents.filter((d): d is CertificationDocument => d.type !== "cedula");
}

/** The RNC must be byte-identical across the three certifications. */
export function checkRncConsistency(documents: ExtractedDocument[]): CoherenceCheck {
  const certifications = certificationsOnly(documents);

  const contributing = certifications.map((document) => ({
    document: document as ExtractedDocument,
    field: "rnc",
    extracted: document.fields.rnc as Extracted<unknown>,
  }));

  const values = new Set(certifications.map((d) => d.fields.rnc.value));

  if (values.size <= 1) {
    return {
      status: "pass",
      detail: `El RNC ${[...values][0] ?? "—"} coincide en los ${certifications.length} documentos.`,
      contributing,
    };
  }

  // No similarity threshold here on purpose: an RNC is an exact identifier, and
  // "almost the same number" is a different taxpayer, not a formatting variant.
  const listed = certifications
    .map((d) => `${d.type}: ${d.fields.rnc.value}`)
    .join("; ");

  return {
    status: "fail",
    detail: `El RNC no coincide entre documentos (${listed}).`,
    contributing,
  };
}

/** Company names must agree once normalised; near-misses warn. */
export function checkCompanyNames(
  documents: ExtractedDocument[],
  nearMatchThreshold: number,
): CoherenceCheck {
  const certifications = certificationsOnly(documents);

  const contributing = certifications.map((document) => ({
    document: document as ExtractedDocument,
    field: "razon_social",
    extracted: document.fields.razon_social as Extracted<unknown>,
  }));

  const normalized = certifications.map((d) => normalizeCompanyName(d.fields.razon_social.value));

  if (new Set(normalized).size <= 1) {
    return {
      status: "pass",
      detail: `La razón social coincide en los ${certifications.length} documentos tras normalizar.`,
      contributing,
    };
  }

  // Compare every pair and let the weakest link decide: one document disagreeing
  // with the rest is exactly the case this check exists to catch.
  let weakest = { score: 1, a: certifications[0], b: certifications[0] };

  for (let i = 0; i < certifications.length; i++) {
    for (let j = i + 1; j < certifications.length; j++) {
      const score = similarity(normalized[i], normalized[j]);
      if (score < weakest.score) {
        weakest = { score, a: certifications[i], b: certifications[j] };
      }
    }
  }

  const comparison = compareCompanyNames(
    weakest.a.fields.razon_social.value,
    weakest.b.fields.razon_social.value,
  );

  const detail =
    `Razón social discrepante entre ${weakest.a.type} ("${weakest.a.fields.razon_social.value}") ` +
    `y ${weakest.b.type} ("${weakest.b.fields.razon_social.value}"); similitud ${comparison.score.toFixed(2)}.`;

  return {
    status: comparison.score >= nearMatchThreshold ? "warn" : "fail",
    detail,
    contributing,
  };
}

/** The cédula holder must be the Registro Mercantil's legal representative. */
export function checkPersonAgainstRepresentative(
  registro: Extract<ExtractedDocument, { type: "registro_mercantil" }>,
  cedula: Extract<ExtractedDocument, { type: "cedula" }>,
  nearMatchThreshold: number,
): CoherenceCheck {
  const representative = registro.fields.representante_legal;
  const holder = cedula.fields.nombre_completo;

  const contributing = [
    { document: registro as ExtractedDocument, field: "representante_legal", extracted: representative as Extracted<unknown> },
    { document: cedula as ExtractedDocument, field: "nombre_completo", extracted: holder as Extracted<unknown> },
  ];

  const comparison = comparePersonNames(representative.value, holder.value);

  if (comparison.verdict === "match") {
    return {
      status: "pass",
      detail: `El titular de la cédula coincide con el representante legal ("${representative.value}").`,
      contributing,
    };
  }

  if (comparison.verdict === "near") {
    return {
      status: "warn",
      detail:
        `Coincidencia parcial entre el representante legal ("${representative.value}") y ` +
        `el titular de la cédula ("${holder.value}"); similitud ${comparison.score.toFixed(2)}. Requiere confirmación.`,
      contributing,
    };
  }

  return {
    status: comparison.score >= nearMatchThreshold ? "warn" : "fail",
    detail:
      `El titular de la cédula ("${holder.value}") no corresponde al representante legal ` +
      `("${representative.value}"); similitud ${comparison.score.toFixed(2)}.`,
    contributing,
  };
}

/** Re-exported so callers do not need a second import for the person case. */
export { normalizePersonName };
