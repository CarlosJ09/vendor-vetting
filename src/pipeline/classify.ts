/**
 * Stage 3 — classify.
 *
 * Decides what each document is, from content alone. Filenames are never
 * consulted: the synthetic corpus deliberately gives them uninformative names,
 * and a classifier that peeked at them would score well while learning nothing.
 */

import type { ClassifiedType } from "@/lib/domain/types";

import type { DocumentContent, ModelProvider, ModelUsage } from "@/models/types";

import type { RenderedDocument } from "./render";

/**
 * How much of a document's text is shown to the classifier.
 *
 * The discriminating features — issuing institution, heading, the shape of the
 * field block — are all near the top. Sending the whole page costs tokens and
 * latency for signal that does not change the answer. This is a deliberate
 * trade-off and the eval measures whether it costs accuracy.
 */
export const CLASSIFY_TEXT_BUDGET = 2000;

export interface ClassificationOutcome {
  type: ClassifiedType;
  confidence: number;
  usage: ModelUsage;
}

/** Turn a rendered document into the content a model can consume. */
export function toModelContent(
  rendered: RenderedDocument,
  options: { textBudget?: number } = {},
): DocumentContent {
  if (rendered.kind === "image") {
    return {
      kind: "image",
      base64: rendered.bytes.toString("base64"),
      mimeType: rendered.mimeType,
    };
  }

  const budget = options.textBudget;
  const text = budget === undefined ? rendered.text : rendered.text.slice(0, budget);

  return { kind: "text", text };
}

export async function classifyDocument(
  rendered: RenderedDocument,
  provider: ModelProvider,
): Promise<ClassificationOutcome> {
  /*
   * A PDF with no text layer is a scan in a PDF wrapper. There is nothing to
   * classify from text, and the current render stage produces no page raster,
   * so it is reported as `unknown` at zero confidence rather than sent to the
   * model to hallucinate over. The synthetic corpus contains no such document;
   * real intake would, and this is where that support would go.
   */
  if (rendered.kind === "pdf" && rendered.needsOcr) {
    return {
      type: "unknown",
      confidence: 0,
      usage: {
        model: "none",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
      },
    };
  }

  const content = toModelContent(rendered, { textBudget: CLASSIFY_TEXT_BUDGET });
  const { result, usage } = await provider.classify(content);

  return { type: result.type, confidence: result.confidence, usage };
}
