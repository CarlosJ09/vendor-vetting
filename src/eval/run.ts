/**
 * The evaluation harness (§9).
 *
 * Runs the full pipeline over the synthetic corpus and scores every stage
 * against ground truth. This is the thing that separates the project from a
 * demo, so it measures what is uncomfortable as well as what flatters:
 * classification accuracy with a confusion matrix, per-field precision and
 * recall, verdict accuracy, and — reported on its own — the rate at which
 * defective dossiers are cleared.
 *
 * Every dossier is evaluated as of its own `referenceDate`, never the wall
 * clock, so results stay comparable across runs forever.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ClassifiedType, DocumentType } from "@/lib/domain/types";
import { DOCUMENT_TYPES } from "@/lib/domain/types";
import { validateDossier } from "@/lib/validation/dossier";
import type { ExtractedDocument } from "@/lib/validation/types";
import { classifyDocument } from "@/pipeline/classify";
import { extractDocument } from "@/pipeline/extract";
import { ingestFolder } from "@/pipeline/ingest";
import { normalizeExtraction } from "@/pipeline/normalize";
import { renderDocument } from "@/pipeline/render";
import type { ModelProvider } from "@/models/types";
import { ModelResponseError } from "@/models/types";

import {
  buildConfusionMatrix,
  computeFieldMetrics,
  computeVerdictMetrics,
  summarizeLatency,
  type ConfusionMatrix,
  type FieldMetrics,
  type FieldObservation,
  type LatencySummary,
  type VerdictMetrics,
} from "./metrics";

export type StageName = "render" | "classify" | "extract" | "normalize" | "validate";

export interface DocumentResult {
  dossierId: string;
  filename: string;
  expectedType: DocumentType;
  predictedType: ClassifiedType;
  classificationConfidence: number;
  /** Present unless classification failed or extraction errored. */
  fieldObservations: FieldObservation[];
  error: string | null;
  timings: Partial<Record<StageName, number>>;
  inputTokens: number;
  outputTokens: number;
}

export interface DossierResult {
  dossierId: string;
  expectedVerdict: string;
  actualVerdict: string;
  defective: boolean;
  defectKinds: string[];
  documents: DocumentResult[];
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface EvalReport {
  generatedAt: string;
  corpusDir: string;
  provider: string;
  textModel: string;
  visionModel: string;
  /** Quantisation reported by the backend, when it exposes it. */
  quantization: Record<string, string | null>;
  dossierCount: number;
  documentCount: number;
  classification: ConfusionMatrix;
  extractionByField: FieldMetrics[];
  extractionByType: Record<string, FieldMetrics[]>;
  verdicts: VerdictMetrics;
  latencyByStage: Record<string, LatencySummary>;
  latencyPerDossier: LatencySummary;
  tokens: { input: number; output: number };
  cost: {
    measuredUsd: number;
    /** Only present when explicit rates were supplied. See `cli.ts`. */
    projectedUsd: number | null;
    rateNote: string;
  };
  errors: { dossierId: string; filename: string; error: string }[];
  dossiers: DossierResult[];
}

interface GroundTruthDocument {
  filename: string;
  type: DocumentType;
  fields: Record<string, unknown>;
}

interface GroundTruth {
  id: string;
  referenceDate: string;
  expectedVerdict: string;
  defects: { kind: string }[];
  documents: GroundTruthDocument[];
}

export interface RunOptions {
  corpusDir: string;
  provider: ModelProvider;
  /** Limit the number of dossiers, for a quick smoke run. */
  limit?: number;
  /** USD per million input/output tokens, for the hosted-cost projection. */
  rates?: { inputPerMillion: number; outputPerMillion: number };
  onProgress?: (done: number, total: number, dossierId: string) => void;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - startedAt };
}

/** One document, carried through every stage of the run. */
interface WorkItem {
  groundTruth: GroundTruth;
  truth: GroundTruthDocument;
  documentId: string;
  filename: string;
  rendered: Awaited<ReturnType<typeof renderDocument>>;
  result: DocumentResult;
  normalized: ExtractedDocument | null;
}

export async function runEval(options: RunOptions): Promise<EvalReport> {
  const { corpusDir, provider } = options;

  const dossierDirs = (await readdir(corpusDir))
    .filter((entry) => entry.startsWith("dossier-"))
    .sort()
    .slice(0, options.limit);

  if (dossierDirs.length === 0) {
    throw new Error(`No dossiers found in ${corpusDir}. Run \`pnpm synth\` first.`);
  }

  const stageTimings: Record<string, number[]> = {};
  const errors: EvalReport["errors"] = [];

  const recordTiming = (stage: StageName, ms: number) => {
    stageTimings[stage] = [...(stageTimings[stage] ?? []), ms];
  };

  /* ------------------------------------------- phase 1: ingest and render -- */

  const groundTruths: GroundTruth[] = [];
  const items: WorkItem[] = [];

  for (const dir of dossierDirs) {
    const dossierPath = path.join(corpusDir, dir);
    const groundTruth = JSON.parse(
      await readFile(path.join(dossierPath, "ground-truth.json"), "utf8"),
    ) as GroundTruth;
    groundTruths.push(groundTruth);

    const truthByFilename = new Map(groundTruth.documents.map((d) => [d.filename, d]));
    const { files } = await ingestFolder(dossierPath);

    for (const file of files) {
      const truth = truthByFilename.get(file.filename);
      if (!truth) continue;

      const bytes = await readFile(file.storagePath);
      const rendered = await timed(() => renderDocument(file, bytes));
      recordTiming("render", rendered.ms);

      items.push({
        groundTruth,
        truth,
        documentId: file.sha256.slice(0, 12),
        filename: file.filename,
        rendered: rendered.value,
        normalized: null,
        result: {
          dossierId: groundTruth.id,
          filename: file.filename,
          expectedType: truth.type,
          predictedType: "unknown",
          classificationConfidence: 0,
          fieldObservations: [],
          error: null,
          timings: { render: rendered.ms },
          inputTokens: 0,
          outputTokens: 0,
        },
      });
    }
  }

  /* ------------------------------------- phase 2: model work, grouped by model -- */

  /*
   * Documents are processed grouped by which model they need, not dossier by
   * dossier. The text and vision models together need roughly 10 GB and the
   * target GPU has 8 GB, so interleaving them forces a swap on every dossier —
   * which in practice produced `CUDA error: device not ready` partway through a
   * run. Grouping means one load of each model for the whole corpus, which is
   * both far more reliable and considerably faster.
   */
  const textItems = items.filter((i) => i.rendered.kind === "pdf");
  const imageItems = items.filter((i) => i.rendered.kind === "image");

  let processed = 0;
  const totalItems = items.length;

  const processItem = async (item: WorkItem): Promise<void> => {
    try {
      const classified = await timed(() => classifyDocument(item.rendered, provider));
      item.result.timings.classify = classified.ms;
      recordTiming("classify", classified.ms);

      item.result.predictedType = classified.value.type;
      item.result.classificationConfidence = classified.value.confidence;
      item.result.inputTokens += classified.value.usage.inputTokens ?? 0;
      item.result.outputTokens += classified.value.usage.outputTokens ?? 0;

      if (classified.value.type === "unknown") return;

      const extracted = await timed(() =>
        extractDocument(item.rendered, classified.value.type as DocumentType, provider),
      );
      item.result.timings.extract = extracted.ms;
      recordTiming("extract", extracted.ms);

      item.result.inputTokens += extracted.value.usage.inputTokens ?? 0;
      item.result.outputTokens += extracted.value.usage.outputTokens ?? 0;

      const normalizedDoc = await timed(async () =>
        normalizeExtraction({
          type: extracted.value.type,
          documentId: item.documentId,
          filename: item.filename,
          fields: extracted.value.fields,
        }),
      );
      item.result.timings.normalize = normalizedDoc.ms;
      recordTiming("normalize", normalizedDoc.ms);
      item.normalized = normalizedDoc.value.document;

      /*
       * Field observations only count when the document was classified
       * correctly. Scoring the DGII schema against a Registro Mercantil's
       * ground truth would report extraction failures that are really
       * classification failures, charging one mistake twice.
       */
      if (classified.value.type === item.truth.type) {
        const actualFields = normalizedDoc.value.document.fields as Record<
          string,
          { value: unknown; confidence: number }
        >;

        for (const [field, expected] of Object.entries(item.truth.fields)) {
          const actual = actualFields[field];
          item.result.fieldObservations.push({
            field: `${item.truth.type}.${field}`,
            expected: String(expected ?? ""),
            actual: actual === undefined ? "" : String(actual.value ?? ""),
            confidence: actual?.confidence ?? 0,
          });
        }
      }
    } catch (error) {
      const message =
        error instanceof ModelResponseError
          ? `${error.message} | raw: ${error.raw.slice(0, 200)}`
          : error instanceof Error
            ? error.message
            : String(error);
      item.result.error = message;
      errors.push({
        dossierId: item.groundTruth.id,
        filename: item.filename,
        error: message,
      });
    } finally {
      processed += 1;
      options.onProgress?.(processed, totalItems, `${item.groundTruth.id}/${item.filename}`);
    }
  };

  for (const item of textItems) await processItem(item);
  if (textItems.length > 0 && imageItems.length > 0) {
    await provider.unload?.(provider.textModel);
  }

  for (const item of imageItems) await processItem(item);
  await provider.unload?.(provider.visionModel);

  /* ---------------------------------------- phase 3: validate each dossier -- */

  const dossiers: DossierResult[] = [];

  for (const groundTruth of groundTruths) {
    const dossierItems = items.filter((i) => i.groundTruth.id === groundTruth.id);
    const normalized = dossierItems
      .map((i) => i.normalized)
      .filter((d): d is ExtractedDocument => d !== null);

    const validated = await timed(async () =>
      validateDossier({ referenceDate: groundTruth.referenceDate, documents: normalized }),
    );
    recordTiming("validate", validated.ms);

    const documents = dossierItems.map((i) => i.result);

    dossiers.push({
      dossierId: groundTruth.id,
      expectedVerdict: groundTruth.expectedVerdict,
      actualVerdict: validated.value.overall,
      defective: groundTruth.defects.length > 0,
      defectKinds: groundTruth.defects.map((d) => d.kind),
      documents,
      totalMs:
        documents.reduce(
          (sum, d) => sum + Object.values(d.timings).reduce((a, b) => a + b, 0),
          0,
        ) + validated.ms,
      inputTokens: documents.reduce((sum, d) => sum + d.inputTokens, 0),
      outputTokens: documents.reduce((sum, d) => sum + d.outputTokens, 0),
    });
  }

  /* ------------------------------------------------------------ aggregate -- */

  const allDocuments = dossiers.flatMap((d) => d.documents);

  const classification = buildConfusionMatrix(
    allDocuments.map((d) => ({ expected: d.expectedType, predicted: d.predictedType })),
    [...DOCUMENT_TYPES, "unknown"],
  );

  const allObservations = allDocuments.flatMap((d) => d.fieldObservations);

  const extractionByType: Record<string, FieldMetrics[]> = {};
  for (const type of DOCUMENT_TYPES) {
    const scoped = allObservations.filter((o) => o.field.startsWith(`${type}.`));
    if (scoped.length > 0) {
      extractionByType[type] = computeFieldMetrics(
        scoped.map((o) => ({ ...o, field: o.field.slice(type.length + 1) })),
      );
    }
  }

  const inputTokens = dossiers.reduce((sum, d) => sum + d.inputTokens, 0);
  const outputTokens = dossiers.reduce((sum, d) => sum + d.outputTokens, 0);

  const projectedUsd =
    options.rates === undefined
      ? null
      : (inputTokens / 1_000_000) * options.rates.inputPerMillion +
        (outputTokens / 1_000_000) * options.rates.outputPerMillion;

  return {
    generatedAt: new Date().toISOString(),
    corpusDir,
    provider: provider.name,
    textModel: provider.textModel,
    visionModel: provider.visionModel,
    quantization: {
      [provider.textModel]: (await provider.quantization?.(provider.textModel)) ?? null,
      [provider.visionModel]: (await provider.quantization?.(provider.visionModel)) ?? null,
    },
    dossierCount: dossiers.length,
    documentCount: allDocuments.length,
    classification,
    extractionByField: computeFieldMetrics(allObservations),
    extractionByType,
    verdicts: computeVerdictMetrics(
      dossiers.map((d) => ({
        dossierId: d.dossierId,
        expected: d.expectedVerdict,
        actual: d.actualVerdict,
        defective: d.defective,
      })),
    ),
    latencyByStage: Object.fromEntries(
      Object.entries(stageTimings).map(([stage, values]) => [stage, summarizeLatency(values)]),
    ),
    latencyPerDossier: summarizeLatency(dossiers.map((d) => d.totalMs)),
    tokens: { input: inputTokens, output: outputTokens },
    cost: {
      // Local inference. Electricity is real but not attributable per dossier.
      measuredUsd: 0,
      projectedUsd,
      rateNote:
        options.rates === undefined
          ? "No hosted-API rates supplied; pass --rate-in and --rate-out to project a cost."
          : `Projected at $${options.rates.inputPerMillion}/M input and $${options.rates.outputPerMillion}/M output tokens, as supplied on the command line.`,
    },
    errors,
    dossiers,
  };
}
