import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateCorpus } from "@/synth/generate";
import type {
  ClassificationResult,
  DocumentContent,
  ExtractionSpec,
  ModelCall,
  ModelProvider,
} from "@/models/types";

import { runEval } from "./run";

/**
 * The eval harness is itself a piece of software that can be wrong, and a bug
 * in it would corrupt every published number. These tests exercise its
 * mechanics — stage grouping, aggregation, error containment — against a stub
 * provider, so they run in milliseconds and need no GPU.
 */

interface StubOptions {
  /** Force a specific classification per document kind. */
  classifyAs?: (content: DocumentContent) => string;
  /** Throw on the nth call, to test error containment. */
  failOnCall?: number;
}

class StubProvider implements ModelProvider {
  readonly name = "stub";
  readonly textModel = "stub-text";
  readonly visionModel = "stub-vision";

  /** Ordered log of which model each call would have used. */
  readonly callLog: ("text" | "image")[] = [];
  readonly unloaded: string[] = [];

  private calls = 0;

  constructor(private readonly options: StubOptions = {}) {}

  async classify(content: DocumentContent): Promise<ModelCall<ClassificationResult>> {
    this.callLog.push(content.kind === "image" ? "image" : "text");
    this.bump();

    const type =
      this.options.classifyAs?.(content) ??
      (content.kind === "image"
        ? "cedula"
        : content.text.includes("IMPUESTOS INTERNOS")
          ? "certificacion_dgii"
          : content.text.includes("SEGURIDAD SOCIAL")
            ? "certificacion_tss"
            : content.text.includes("REGISTRO MERCANTIL")
              ? "registro_mercantil"
              : "unknown");

    return {
      result: { type: type as ClassificationResult["type"], confidence: 0.9 },
      usage: { model: "stub", inputTokens: 10, outputTokens: 5, latencyMs: 1, costUsd: 0 },
      raw: "{}",
    };
  }

  async extract<T>(content: DocumentContent, spec: ExtractionSpec<T>): Promise<ModelCall<T>> {
    this.callLog.push(content.kind === "image" ? "image" : "text");
    this.bump();

    // Every field abstains: recall should come out at zero, which is a shape
    // the metrics must handle without dividing by anything.
    const shape = spec.schema as unknown as { _zod?: { def?: { shape?: Record<string, unknown> } } };
    const keys = Object.keys(shape._zod?.def?.shape ?? {});
    const fields = Object.fromEntries(
      keys.map((key) => [
        key,
        { value: key === "estado" ? "indeterminado" : "", confidence: 0.3, page: 1 },
      ]),
    );

    return {
      result: fields as T,
      usage: { model: "stub", inputTokens: 20, outputTokens: 8, latencyMs: 1, costUsd: 0 },
      raw: "{}",
    };
  }

  async unload(model: string): Promise<void> {
    this.unloaded.push(model);
  }

  async quantization(): Promise<string | null> {
    return "Q4_K_M";
  }

  private bump(): void {
    this.calls += 1;
    if (this.options.failOnCall === this.calls) {
      throw new Error("stub failure");
    }
  }
}

describe("runEval", () => {
  let corpus: string;

  beforeEach(async () => {
    corpus = await mkdtemp(path.join(tmpdir(), "vetting-eval-"));
    await generateCorpus({ outDir: corpus, count: 3, defectiveRatio: 0, seed: 5, clean: true });
  }, 120_000);

  afterEach(async () => {
    await rm(corpus, { recursive: true, force: true });
  });

  it("scores every dossier in the corpus", async () => {
    const provider = new StubProvider();
    const report = await runEval({ corpusDir: corpus, provider });

    expect(report.dossierCount).toBe(3);
    expect(report.documentCount).toBe(12);
    expect(report.dossiers).toHaveLength(3);
  }, 120_000);

  it("processes all text documents before any image document", async () => {
    // Grouping by model is what keeps a machine that cannot hold both models in
    // VRAM from swapping on every dossier. If this regresses, runs start
    // failing with CUDA errors partway through.
    const provider = new StubProvider();
    await runEval({ corpusDir: corpus, provider });

    const firstImage = provider.callLog.indexOf("image");
    const lastText = provider.callLog.lastIndexOf("text");

    expect(firstImage).toBeGreaterThan(-1);
    expect(lastText).toBeLessThan(firstImage);
  }, 120_000);

  it("releases the text model before switching to vision", async () => {
    const provider = new StubProvider();
    await runEval({ corpusDir: corpus, provider });

    expect(provider.unloaded).toContain("stub-text");
  }, 120_000);

  it("records quantisation for both models", async () => {
    const report = await runEval({ corpusDir: corpus, provider: new StubProvider() });

    expect(report.quantization["stub-text"]).toBe("Q4_K_M");
    expect(report.quantization["stub-vision"]).toBe("Q4_K_M");
  }, 120_000);

  it("reports zero recall when the model abstains on every field", async () => {
    const report = await runEval({ corpusDir: corpus, provider: new StubProvider() });

    const rncMetrics = report.extractionByType.registro_mercantil?.find((m) => m.field === "rnc");
    expect(rncMetrics?.recall).toBe(0);
    expect(rncMetrics?.falseNegatives).toBeGreaterThan(0);
  }, 120_000);

  it("contains a provider failure to the affected document", async () => {
    // One bad document must not abort the run; the other eleven still get
    // scored, and the failure is reported rather than swallowed.
    const provider = new StubProvider({ failOnCall: 3 });
    const report = await runEval({ corpusDir: corpus, provider });

    expect(report.errors).toHaveLength(1);
    expect(report.dossierCount).toBe(3);
    expect(report.documentCount).toBe(12);
  }, 120_000);

  it("does not score extraction for a misclassified document", async () => {
    // A wrong type is one mistake, not two: it must not also show up as a pile
    // of extraction misses against the wrong schema.
    const provider = new StubProvider({ classifyAs: () => "cedula" });
    const report = await runEval({ corpusDir: corpus, provider });

    expect(report.classification.accuracy).toBeLessThan(1);
    expect(report.extractionByType.registro_mercantil).toBeUndefined();
  }, 120_000);

  it("leaves cost at zero and records token totals", async () => {
    const report = await runEval({ corpusDir: corpus, provider: new StubProvider() });

    expect(report.cost.measuredUsd).toBe(0);
    expect(report.cost.projectedUsd).toBeNull();
    expect(report.tokens.input).toBeGreaterThan(0);
  }, 120_000);

  it("projects a hosted cost only when rates are supplied", async () => {
    const report = await runEval({
      corpusDir: corpus,
      provider: new StubProvider(),
      rates: { inputPerMillion: 3, outputPerMillion: 15 },
    });

    const expected =
      (report.tokens.input / 1_000_000) * 3 + (report.tokens.output / 1_000_000) * 15;
    expect(report.cost.projectedUsd).toBeCloseTo(expected, 10);
  }, 120_000);

  it("records latency for every stage that ran", async () => {
    const report = await runEval({ corpusDir: corpus, provider: new StubProvider() });

    for (const stage of ["render", "classify", "extract", "normalize", "validate"]) {
      expect(report.latencyByStage[stage]?.count).toBeGreaterThan(0);
    }
  }, 120_000);
});
