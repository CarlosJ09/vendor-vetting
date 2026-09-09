/**
 * Stage 5 — normalize.
 *
 * Converts raw extractions into the typed shape the validation layer consumes:
 * dates parsed, identifiers stripped of separators, strings trimmed.
 *
 * This is where the model's output stops being text and starts being data, and
 * it is all deterministic, tested code. The model was never asked to produce
 * `2025-08-03` from `03/08/2025` — that is arithmetic on a calendar, and a
 * transcription model has no reason to get it right.
 *
 * ## Unparseable values
 *
 * A date that will not parse is not an error to throw on and not a value to
 * guess at. The raw text is kept and the field's confidence is forced to zero,
 * which routes the requirement that depends on it to `needs_review`. The
 * evidence still points at what the document actually said, so a human can see
 * why the parse failed.
 */

import { parseDominicanDate } from "@/lib/dates";
import type { ComplianceStatus, DocumentType, Extracted } from "@/lib/domain/types";
import { normalizeCedula } from "@/lib/identifiers/cedula";
import { normalizeRnc } from "@/lib/identifiers/rnc";
import type { ExtractedDocument } from "@/lib/validation/types";

import type { RawExtraction } from "@/models/schemas";

/** Fields that hold a date, per document type. */
const DATE_FIELDS: Record<DocumentType, readonly string[]> = {
  registro_mercantil: ["fecha_emision", "fecha_vencimiento"],
  certificacion_dgii: ["fecha_emision"],
  certificacion_tss: ["fecha_emision"],
  cedula: ["fecha_nacimiento", "fecha_vencimiento"],
};

/** Fields that hold an identifier whose separators must be stripped. */
const IDENTIFIER_FIELDS: Record<DocumentType, readonly string[]> = {
  registro_mercantil: ["rnc"],
  certificacion_dgii: ["rnc"],
  certificacion_tss: ["rnc"],
  cedula: ["cedula"],
};

interface RawField {
  value: string | ComplianceStatus;
  confidence: number;
  page: number;
}

export interface NormalizationIssue {
  field: string;
  raw: string;
  reason: "unparseable_date" | "empty_value";
}

export interface NormalizeResult {
  document: ExtractedDocument;
  issues: NormalizationIssue[];
}

/**
 * Collapse whitespace and trim.
 *
 * Accents and case are deliberately preserved: the dossier shows these values
 * back to a human, and folding them here would make the evidence differ from
 * the document. Case-insensitive comparison happens inside the name-matching
 * code, where it belongs.
 */
function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeExtraction<T extends DocumentType>(input: {
  type: T;
  documentId: string;
  filename: string;
  fields: RawExtraction[T];
}): NormalizeResult {
  const dateFields = new Set(DATE_FIELDS[input.type]);
  const identifierFields = new Set(IDENTIFIER_FIELDS[input.type]);

  const issues: NormalizationIssue[] = [];
  const normalized: Record<string, Extracted<unknown>> = {};

  for (const [field, rawField] of Object.entries(input.fields as Record<string, RawField>)) {
    const raw = typeof rawField.value === "string" ? rawField.value : String(rawField.value);
    const trimmed = cleanText(raw);

    if (trimmed === "") {
      issues.push({ field, raw, reason: "empty_value" });
      normalized[field] = { value: "", confidence: 0, page: rawField.page };
      continue;
    }

    if (dateFields.has(field)) {
      const parsed = parseDominicanDate(trimmed);

      if (parsed === null) {
        issues.push({ field, raw: trimmed, reason: "unparseable_date" });
        // Keep the raw text as evidence, but zero confidence so the rule that
        // depends on it goes to review instead of running on a bad value.
        normalized[field] = { value: trimmed, confidence: 0, page: rawField.page };
        continue;
      }

      normalized[field] = { value: parsed, confidence: rawField.confidence, page: rawField.page };
      continue;
    }

    if (identifierFields.has(field)) {
      const compact = field === "cedula" ? normalizeCedula(trimmed) : normalizeRnc(trimmed);
      normalized[field] = { value: compact, confidence: rawField.confidence, page: rawField.page };
      continue;
    }

    normalized[field] = { value: trimmed, confidence: rawField.confidence, page: rawField.page };
  }

  return {
    document: {
      type: input.type,
      documentId: input.documentId,
      filename: input.filename,
      fields: normalized,
    } as ExtractedDocument,
    issues,
  };
}
