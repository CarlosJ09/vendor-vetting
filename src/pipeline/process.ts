/**
 * The pipeline, run end to end over one folder, and persisted.
 *
 * `src/eval/run.ts` runs the same stages but keeps everything in memory and
 * scores it against ground truth. This is the other consumer: it writes each
 * stage's result to Postgres so the dossier UI has something to read and so a
 * stage can be re-run without repeating the model calls before it (§7).
 *
 * The two are deliberately separate. Folding persistence into the eval would
 * make a benchmark depend on a database being up, and folding scoring into this
 * would require ground truth that real intake does not have.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { persistDossierRun } from "@/db/persist";
import type { PersistDocument, PersistStageRun, PipelineStage } from "@/db/persist";
import { CONFIDENCE_THRESHOLD } from "@/lib/config";
import type { ClassifiedType, DocumentType } from "@/lib/domain/types";
import { validateDossier } from "@/lib/validation/dossier";
import type { DossierReport, ExtractedDocument } from "@/lib/validation/types";
import type { ModelProvider } from "@/models/types";
import { ModelResponseError } from "@/models/types";

import { classifyDocument } from "./classify";
import { extractDocument } from "./extract";
import { ingestFolder } from "./ingest";
import { locateValue } from "./locate";
import type { Citation } from "./locate";
import type { IngestedFile } from "./ingest";
import { normalizeExtraction } from "./normalize";
import { renderDocument } from "./render";

export interface ProcessOptions {
  folderPath: string;
  provider: ModelProvider;
  /**
   * The date the dossier is judged as of.
   *
   * Defaults to today, but the synthetic corpus passes its own so a re-run in
   * six months still produces the verdict the ground truth expects.
   */
  referenceDate?: string;
  /** External identifier; defaults to the folder name. */
  externalId?: string;
  confidenceThreshold?: number;
  onProgress?: (message: string) => void;
}

export interface ProcessResult {
  dossierId: string;
  externalId: string;
  report: DossierReport;
  documentCount: number;
  skipped: { filename: string; reason: string }[];
  errors: { filename: string; error: string }[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function messageOf(error: unknown): string {
  if (error instanceof ModelResponseError) {
    return `${error.message} | raw: ${error.raw.slice(0, 200)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** One document as it moves through the stages, accumulating what gets stored. */
interface Tracked {
  file: IngestedFile;
  localId: string;
  /** The file's bytes, read once at render and reused for storage. */
  bytes: Buffer | null;
  classifiedType: ClassifiedType | null;
  classificationConfidence: number | null;
  pageCount: number | null;
  /** Raw model output per field, kept alongside the normalised value. */
  rawValues: Record<string, string>;
  /** Where each raw value was found in the text layer, when it was found. */
  citations: Record<string, Citation | null>;
  normalized: ExtractedDocument | null;
  stageRuns: PersistStageRun[];
  error: string | null;
}

export async function processFolder(options: ProcessOptions): Promise<ProcessResult> {
  const { folderPath, provider } = options;
  const externalId = options.externalId ?? path.basename(folderPath);
  const referenceDate = options.referenceDate ?? today();
  const threshold = options.confidenceThreshold ?? CONFIDENCE_THRESHOLD;
  const progress = options.onProgress ?? (() => {});

  const dossierStageRuns: PersistStageRun[] = [];

  const ingestStartedAt = new Date();
  const { files, skipped } = await ingestFolder(folderPath);
  dossierStageRuns.push({
    stage: "ingest",
    status: "ok",
    startedAt: ingestStartedAt,
    finishedAt: new Date(),
    durationMs: Date.now() - ingestStartedAt.getTime(),
    output: { accepted: files.length, skipped },
  });

  if (files.length === 0) {
    throw new Error(`No readable documents found in ${folderPath}`);
  }

  const tracked: Tracked[] = files.map((file, index) => ({
    file,
    /*
     * A per-file handle that exists before any database row does, which is what
     * evidence references are keyed on.
     *
     * The ordinal is not decoration. This was the content hash alone, and the
     * corpus's deliberate duplicate-document defect puts two byte-identical
     * files in one folder — which gave them the same id, merged them into a
     * single row, and made every duplicate dossier fail to persist. Ingest
     * order is deterministic, so the ordinal is stable across runs.
     */
    localId: `${file.sha256.slice(0, 12)}-${index}`,
    bytes: null,
    classifiedType: null,
    classificationConfidence: null,
    pageCount: null,
    rawValues: {},
    citations: {},
    normalized: null,
    stageRuns: [],
    error: null,
  }));

  const errors: ProcessResult["errors"] = [];

  const processItem = async (item: Tracked): Promise<void> => {
    progress(`${externalId}/${item.file.filename}`);

    /*
     * Which stage is in flight, so a failure is recorded against the stage that
     * actually failed. Attributing a render crash to `extract` sends whoever
     * debugs it to the prompt when the problem was a malformed PDF.
     */
    let stage: PipelineStage = "render";

    try {
      const renderStartedAt = new Date();
      const bytes = await readFile(item.file.storagePath);
      item.bytes = bytes;
      const rendered = await renderDocument(item.file, bytes);
      item.pageCount = rendered.kind === "pdf" ? rendered.pageCount : 1;
      item.stageRuns.push({
        stage: "render",
        status: "ok",
        localDocumentId: item.localId,
        startedAt: renderStartedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - renderStartedAt.getTime(),
        // The text layer itself is not stored: it is recoverable from the file
        // on disk, and it would dominate the size of the table.
        output: rendered.kind === "pdf"
          ? { kind: "pdf", pageCount: rendered.pageCount, needsOcr: rendered.needsOcr }
          : { kind: "image", width: rendered.width, height: rendered.height },
      });

      stage = "classify";
      const classifyStartedAt = new Date();
      const classified = await classifyDocument(rendered, provider);
      item.classifiedType = classified.type;
      item.classificationConfidence = classified.confidence;
      item.stageRuns.push({
        stage: "classify",
        status: "ok",
        localDocumentId: item.localId,
        startedAt: classifyStartedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - classifyStartedAt.getTime(),
        model: rendered.kind === "image" ? provider.visionModel : provider.textModel,
        inputTokens: classified.usage.inputTokens ?? null,
        outputTokens: classified.usage.outputTokens ?? null,
        output: { type: classified.type, confidence: classified.confidence },
      });

      if (classified.type === "unknown") {
        // Not an error: an unrecognised file is a legitimate outcome, and the
        // completeness requirement is what turns it into a finding.
        item.stageRuns.push({
          stage: "extract",
          status: "skipped",
          localDocumentId: item.localId,
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
        });
        return;
      }

      stage = "extract";
      const extractStartedAt = new Date();
      const extracted = await extractDocument(rendered, classified.type as DocumentType, provider);
      item.stageRuns.push({
        stage: "extract",
        status: "ok",
        localDocumentId: item.localId,
        startedAt: extractStartedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - extractStartedAt.getTime(),
        model: rendered.kind === "image" ? provider.visionModel : provider.textModel,
        inputTokens: extracted.usage.inputTokens ?? null,
        outputTokens: extracted.usage.outputTokens ?? null,
        output: extracted.fields,
      });

      for (const [field, value] of Object.entries(
        extracted.fields as Record<string, { value: unknown }>,
      )) {
        const raw = String(value?.value ?? "");
        item.rawValues[field] = raw;
        /*
         * Located against the text layer, which is why this only runs for PDFs.
         * A scanned cedula has no text to search, so its fields carry no region
         * and the dossier says so rather than showing an invented box.
         */
        item.citations[field] =
          rendered.kind === "pdf" && raw !== "" ? locateValue(rendered.pages, raw) : null;
      }

      stage = "normalize";
      const normalizeStartedAt = new Date();
      const { document, issues } = normalizeExtraction({
        type: extracted.type,
        documentId: item.localId,
        filename: item.file.filename,
        fields: extracted.fields,
      });
      item.normalized = document;
      item.stageRuns.push({
        stage: "normalize",
        status: "ok",
        localDocumentId: item.localId,
        startedAt: normalizeStartedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - normalizeStartedAt.getTime(),
        output: { issues },
      });
    } catch (error) {
      const message = messageOf(error);
      item.error = message;
      errors.push({ filename: item.file.filename, error: message });
      item.stageRuns.push({
        stage,
        status: "error",
        localDocumentId: item.localId,
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
        error: message,
      });
    }
  };

  /*
   * Text documents first, then images, with the text model unloaded in between
   * and the vision model unloaded at the end.
   *
   * The two models together need roughly 10 GB and the development GPU has 8.
   * A dossier is three PDFs and one scanned cedula, so processing files in
   * whatever order the folder lists them makes the backend swap models
   * repeatedly, and the eval hit `CUDA error: device not ready` doing exactly
   * that. This costs one model load per dossier and buys reliability.
   *
   * On a backend with room for both — or a hosted API — `unload` is a no-op and
   * the ordering costs nothing.
   */
  const textFiles = tracked.filter((item) => item.file.kind === "pdf");
  const imageFiles = tracked.filter((item) => item.file.kind === "image");

  for (const item of textFiles) await processItem(item);
  if (textFiles.length > 0 && imageFiles.length > 0) {
    await provider.unload?.(provider.textModel);
  }

  for (const item of imageFiles) await processItem(item);
  if (imageFiles.length > 0) await provider.unload?.(provider.visionModel);

  const validateStartedAt = new Date();
  const report = validateDossier({
    referenceDate,
    documents: tracked
      .map((item) => item.normalized)
      .filter((document): document is ExtractedDocument => document !== null),
    config: { confidenceThreshold: threshold },
  });
  dossierStageRuns.push({
    stage: "validate",
    status: "ok",
    startedAt: validateStartedAt,
    finishedAt: new Date(),
    durationMs: Date.now() - validateStartedAt.getTime(),
    output: { overall: report.overall, reviewQueueSize: report.reviewQueue.length },
  });

  const persistDocuments: PersistDocument[] = tracked.map((item) => ({
    localId: item.localId,
    filename: item.file.filename,
    storagePath: item.file.storagePath,
    mimeType: item.file.mimeType,
    byteSize: item.file.byteSize,
    sha256: item.file.sha256,
    classifiedType: item.classifiedType,
    classificationConfidence: item.classificationConfidence,
    pageCount: item.pageCount,
    content: item.bytes,
    fields:
      item.normalized === null
        ? []
        : Object.entries(
            item.normalized.fields as Record<
              string,
              { value: unknown; confidence: number; page?: number; bbox?: unknown }
            >,
          ).map(([field, extracted]) => {
            const citation = item.citations[field] ?? null;

            return {
              field,
              rawValue: item.rawValues[field] ?? null,
              normalizedValue: String(extracted.value ?? ""),
              confidence: extracted.confidence,
              // The located page is preferred over the model's: one was read
              // off the text layer, the other was self-reported.
              page: citation?.page ?? extracted.page ?? null,
              bbox: citation?.bbox ?? null,
              needsReview: extracted.confidence < threshold,
            };
          }),
  }));

  const { dossierId } = await persistDossierRun({
    externalId,
    referenceDate,
    sourcePath: path.resolve(folderPath),
    report,
    documents: persistDocuments,
    stageRuns: [...dossierStageRuns, ...tracked.flatMap((item) => item.stageRuns)],
  });

  return {
    dossierId,
    externalId,
    report,
    documentCount: persistDocuments.length,
    skipped: skipped.map((entry) => ({ filename: entry.filename, reason: entry.reason })),
    errors,
  };
}
