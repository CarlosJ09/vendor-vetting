/**
 * Ollama adapter.
 *
 * Talks to the local server over plain HTTP with the runtime's own `fetch`. The
 * official client package would add a dependency to wrap three endpoints, and a
 * short dependency list is part of this project's story (§8).
 *
 * Structured output uses Ollama's `format` parameter, which constrains
 * generation to a JSON Schema rather than asking politely for JSON and hoping.
 * The response is still validated with zod before it is trusted: schema-guided
 * decoding controls shape, not whether the content makes sense.
 */

import { z } from "zod";

import type { ClassifiedType } from "@/lib/domain/types";

import {
  CLASSIFY_INSTRUCTIONS,
  CLASSIFY_SYSTEM,
  EXTRACT_SYSTEM,
  textPrompt,
} from "./prompts";
import { classificationSchema, toJsonSchema } from "./schemas";
import {
  ModelResponseError,
  type ClassificationResult,
  type DocumentContent,
  type ExtractionSpec,
  type ModelCall,
  type ModelProvider,
  type ModelUsage,
} from "./types";

export interface OllamaOptions {
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  /** Per-request timeout. Cold model loads on 8 GB of VRAM are not fast. */
  timeoutMs?: number;
}

export const OLLAMA_DEFAULTS = {
  baseUrl: "http://localhost:11434",
  textModel: "qwen2.5:7b",
  visionModel: "qwen2.5vl:7b",
  timeoutMs: 180_000,
} as const;

/** Shape of the pieces of `/api/chat` we rely on. */
const chatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  model: z.string(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  load_duration: z.number().optional(),
});

interface ChatMessage {
  role: "system" | "user";
  content: string;
  /** Base64 image payloads, without a data: prefix. */
  images?: string[];
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  readonly textModel: string;
  readonly visionModel: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OLLAMA_HOST ?? OLLAMA_DEFAULTS.baseUrl).replace(
      /\/$/,
      "",
    );
    this.textModel = options.textModel ?? process.env.OLLAMA_TEXT_MODEL ?? OLLAMA_DEFAULTS.textModel;
    this.visionModel =
      options.visionModel ?? process.env.OLLAMA_VISION_MODEL ?? OLLAMA_DEFAULTS.visionModel;
    this.timeoutMs = options.timeoutMs ?? OLLAMA_DEFAULTS.timeoutMs;
  }

  /** True when the server answers. Used to fail fast with a clear message. */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Quantisation level the backend reports for a model, or null.
   *
   * §9 requires results to name the model *and* its quantisation: `qwen2.5:7b`
   * at Q4_K_M and at Q8_0 are different systems, and a published number that
   * does not say which one it measured is not reproducible.
   */
  async quantization(model: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;

      const body = (await response.json()) as {
        details?: { quantization_level?: string };
      };
      return body.details?.quantization_level ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Ask the server to drop a model from memory.
   *
   * Needed on constrained hardware: the text and vision models together exceed
   * 8 GB of VRAM, so they cannot both be resident. Letting Ollama evict them
   * implicitly under pressure produced `CUDA error: device not ready` mid-run,
   * with `/api/ps` still claiming the model was loaded while nvidia-smi showed
   * an empty GPU. Unloading explicitly at a known point is far more reliable
   * than provoking an eviction and hoping.
   */
  async unload(model: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Best effort: a failed unload is not worth aborting a run over.
    }
  }

  async classify(content: DocumentContent): Promise<ModelCall<ClassificationResult>> {
    const { result, usage, raw } = await this.chatWithRetry({
      content,
      system: CLASSIFY_SYSTEM,
      instructions: CLASSIFY_INSTRUCTIONS,
      schema: classificationSchema,
    });

    return {
      result: { type: result.type as ClassifiedType, confidence: result.confidence },
      usage,
      raw,
    };
  }

  async extract<T>(content: DocumentContent, spec: ExtractionSpec<T>): Promise<ModelCall<T>> {
    return this.chatWithRetry({
      content,
      system: EXTRACT_SYSTEM,
      instructions: spec.instructions,
      schema: spec.schema,
    });
  }

  /* ------------------------------------------------------------- internals -- */

  /**
   * Run `chat`, retrying once on a server-side failure.
   *
   * Retries exist for one specific, observed fault: a transient CUDA error when
   * the runtime is swapping models under VRAM pressure. It is not a general
   * "try again and hope" — a schema mismatch or a bad request is deterministic
   * and is surfaced immediately rather than retried.
   */
  private async chatWithRetry<T>(input: {
    content: DocumentContent;
    system: string;
    instructions: string;
    schema: z.ZodType<T>;
  }): Promise<ModelCall<T>> {
    try {
      return await this.chat(input);
    } catch (error) {
      const retryable =
        error instanceof ModelResponseError && /CUDA|unexpected EOF|500/i.test(error.message);
      if (!retryable) throw error;

      // Give the runtime a moment to finish releasing the device.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return this.chat(input);
    }
  }

  private async chat<T>(input: {
    content: DocumentContent;
    system: string;
    instructions: string;
    schema: z.ZodType<T>;
  }): Promise<ModelCall<T>> {
    const isImage = input.content.kind === "image";
    const model = isImage ? this.visionModel : this.textModel;

    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      input.content.kind === "text"
        ? { role: "user", content: textPrompt(input.instructions, input.content.text) }
        : { role: "user", content: input.instructions, images: [input.content.base64] },
    ];

    const startedAt = Date.now();

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: toJsonSchema(input.schema),
        // Greedy decoding: extraction should be reproducible run to run, and a
        // corpus whose numbers move under resampling cannot be regression-tested.
        options: { temperature: 0, seed: 1 },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ModelResponseError(
        `Ollama returned ${response.status} ${response.statusText} for model ${model}`,
        body,
      );
    }

    const envelope = chatResponseSchema.safeParse(await response.json());
    if (!envelope.success) {
      throw new ModelResponseError("Unexpected /api/chat response envelope", "");
    }

    const raw = envelope.data.message.content;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new ModelResponseError("Model output was not valid JSON", raw);
    }

    const parsed = input.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ModelResponseError(
        `Model output did not match the schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        raw,
      );
    }

    const usage: ModelUsage = {
      model: envelope.data.model,
      inputTokens: envelope.data.prompt_eval_count ?? null,
      outputTokens: envelope.data.eval_count ?? null,
      latencyMs,
      // Local inference. The token counts above are what a hosted-API cost
      // projection is computed from; see §9.
      costUsd: 0,
      loadMs:
        envelope.data.load_duration === undefined
          ? null
          : Math.round(envelope.data.load_duration / 1_000_000),
    };

    return { result: parsed.data, usage, raw };
  }
}
