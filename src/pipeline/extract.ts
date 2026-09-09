/**
 * Stage 4 — extract.
 *
 * Pulls the fields for a known document type. Runs after `classify`, because
 * each type has its own schema and its own instructions; asking one prompt to
 * handle all four would trade accuracy for a shorter file.
 *
 * The output here is still *raw*: values are whatever the document printed,
 * unparsed. Turning `03/08/2025` into a date is the `normalize` stage's job,
 * done by tested code rather than by the model.
 */

import type { z } from "zod";

import type { DocumentType } from "@/lib/domain/types";

import { EXTRACT_INSTRUCTIONS } from "@/models/prompts";
import { EXTRACTION_SCHEMAS, type RawExtraction } from "@/models/schemas";
import type { ModelProvider, ModelUsage } from "@/models/types";

import { toModelContent } from "./classify";
import type { RenderedDocument } from "./render";

export interface ExtractionOutcome<T extends DocumentType> {
  type: T;
  fields: RawExtraction[T];
  usage: ModelUsage;
  /** Raw model output, retained so a bad extraction can be inspected later. */
  raw: string;
}

export async function extractDocument<T extends DocumentType>(
  rendered: RenderedDocument,
  type: T,
  provider: ModelProvider,
): Promise<ExtractionOutcome<T>> {
  /*
   * `EXTRACTION_SCHEMAS` and `RawExtraction` are keyed by the same document
   * types and generated from each other, so this correspondence holds — but
   * TypeScript cannot correlate two indexed accesses through a generic
   * parameter, and widens the lookup to a union of all four schemas instead.
   */
  const schema = EXTRACTION_SCHEMAS[type] as unknown as z.ZodType<RawExtraction[T]>;
  const instructions = EXTRACT_INSTRUCTIONS[type];

  if (!instructions) {
    throw new Error(`No extraction instructions defined for document type ${type}`);
  }

  // No text budget here, unlike classification: a field can appear anywhere on
  // the page, and truncating the input would silently lose one.
  const content = toModelContent(rendered);

  const { result, usage, raw } = await provider.extract(content, {
    name: type,
    schema,
    instructions,
  });

  return { type, fields: result, usage, raw };
}
