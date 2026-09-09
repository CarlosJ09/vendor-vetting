/**
 * The model provider interface.
 *
 * Exactly two methods, per §8.1: `classify` and `extract`. Nothing above this
 * interface knows which model answered, which is what lets the eval be run
 * against different backends and compared rather than excused.
 *
 * Note what is absent: there is no `judge`, no `validate`, no `decide`. The
 * model reports what a document says. Whether that means the document is
 * acceptable is decided in `src/lib/validation`, by code, with unit tests.
 */

import type { z } from "zod";

import type { ClassifiedType } from "@/lib/domain/types";

/** What a document looks like to a model: either its text layer or its pixels. */
export type DocumentContent =
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mimeType: string };

/**
 * Per-call resource accounting.
 *
 * Recorded for every call because §9 requires cost and latency per stage, and
 * neither can be reconstructed after the fact. `costUsd` is 0 for local
 * inference; the token counts are what make a hosted-API projection possible.
 */
export interface ModelUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  costUsd: number;
  /** Time the backend spent loading the model, when it reports it separately. */
  loadMs?: number | null;
}

export interface ClassificationResult {
  type: ClassifiedType;
  /** The model's own confidence in `[0, 1]`. See the caveat in `prompts.ts`. */
  confidence: number;
}

export interface ExtractionSpec<T> {
  /** Identifier used in logs and eval output. */
  name: string;
  /** Shape the model must return; also the structured-output constraint. */
  schema: z.ZodType<T>;
  /** Task-specific instructions appended to the shared extraction preamble. */
  instructions: string;
}

export interface ModelCall<T> {
  result: T;
  usage: ModelUsage;
  /** Raw response text, kept for debugging a bad parse. */
  raw: string;
}

export interface ModelProvider {
  readonly name: string;
  /** Model used for text-only documents. */
  readonly textModel: string;
  /** Model used for images. */
  readonly visionModel: string;

  classify(content: DocumentContent): Promise<ModelCall<ClassificationResult>>;

  extract<T>(content: DocumentContent, spec: ExtractionSpec<T>): Promise<ModelCall<T>>;

  /**
   * Release a model from memory, if the backend has a notion of that.
   *
   * Optional because it is meaningful for a local runtime and meaningless for a
   * hosted API. The eval uses it to control when the text and vision models
   * swap, which matters on hardware that cannot hold both at once.
   */
  unload?(model: string): Promise<void>;

  /** Quantisation tag for a model, when the backend reports one. */
  quantization?(model: string): Promise<string | null>;
}

/** Raised when the backend answers but the answer does not fit the schema. */
export class ModelResponseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "ModelResponseError";
  }
}
