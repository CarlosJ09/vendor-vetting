/**
 * Writing a pipeline run to the database, and reading it back.
 *
 * ## Why re-running replaces rather than appends
 *
 * A dossier has one current verdict. Keeping every historical run would make
 * every read query pick a winner, and nothing in the brief asks for run history
 * — the eval already keeps its own dated results files (§9). So a second run of
 * the same `externalId` reuses the row and replaces its children.
 *
 * ## Identifier remapping
 *
 * The pipeline works with in-memory document ids (a content hash prefix) because
 * validation runs long before anything is written. The database issues its own
 * UUIDs. Evidence references are rewritten from the former to the latter on the
 * way in, so the dossier UI can link a finding to a stored document without
 * knowing anything about how the pipeline named things.
 */

import { desc, eq, inArray } from "drizzle-orm";

import type { BBox, ClassifiedType, RequirementStatus } from "@/lib/domain/types";
import type { DossierReport } from "@/lib/validation/types";

import { db } from "./client";
import {
  documents,
  dossiers,
  extractedFields,
  requirementResults,
  stageRuns,
} from "./schema";
import type { Document, Dossier, ExtractedField, RequirementResult, StageRun } from "./schema";

export type PipelineStage = (typeof stageRuns.$inferInsert)["stage"];
type StageStatus = (typeof stageRuns.$inferInsert)["status"];

export interface PersistField {
  field: string;
  rawValue: string | null;
  normalizedValue: string | null;
  confidence: number;
  page: number | null;
  bbox: BBox | null;
  needsReview: boolean;
}

export interface PersistDocument {
  /** The pipeline's in-memory id, used to resolve evidence references. */
  localId: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  classifiedType: ClassifiedType | null;
  classificationConfidence: number | null;
  pageCount: number | null;
  /**
   * The file's bytes, stored so a deployment can serve it without the machine
   * that ingested it. Optional: omitting it leaves the row pointing only at
   * `storagePath`, which is all local development needs.
   */
  content?: Buffer | null;
  fields: PersistField[];
}

export interface PersistStageRun {
  stage: PipelineStage;
  status: StageStatus;
  /** Omitted for stages that operate on the dossier as a whole. */
  localDocumentId?: string;
  startedAt: Date;
  finishedAt?: Date | null;
  durationMs?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  output?: unknown;
  error?: string | null;
}

export interface PersistInput {
  externalId: string;
  referenceDate: string;
  sourcePath: string;
  report: DossierReport;
  documents: PersistDocument[];
  stageRuns?: PersistStageRun[];
}

export interface PersistResult {
  dossierId: string;
  documentIdsByLocalId: Record<string, string>;
  requirementCount: number;
}

export async function persistDossierRun(input: PersistInput): Promise<PersistResult> {
  /*
   * Local ids index the map that rewrites evidence references, so a collision
   * silently merges two documents into one and the failure surfaces much later
   * as a unique-index violation on their fields. Checked here, where the
   * message can name the id that collided.
   */
  const seen = new Set<string>();
  for (const document of input.documents) {
    if (seen.has(document.localId)) {
      throw new Error(
        `Duplicate local id ${document.localId} in dossier ${input.externalId}` +
          ` (${document.filename}). Local ids must be unique per file, not per content.`,
      );
    }
    seen.add(document.localId);
  }

  return db().transaction(async (tx) => {
    const [dossier] = await tx
      .insert(dossiers)
      .values({
        externalId: input.externalId,
        referenceDate: input.referenceDate,
        sourcePath: input.sourcePath,
        overallStatus: input.report.overall,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dossiers.externalId,
        set: {
          referenceDate: input.referenceDate,
          sourcePath: input.sourcePath,
          overallStatus: input.report.overall,
          completedAt: new Date(),
        },
      })
      .returning();

    /*
     * Children of a previous run are dropped wholesale. Diffing them would be
     * more code for a worse result: a re-run can classify a file as a different
     * type, which changes the entire set of field names underneath it.
     */
    await tx.delete(documents).where(eq(documents.dossierId, dossier.id));
    await tx.delete(requirementResults).where(eq(requirementResults.dossierId, dossier.id));
    await tx.delete(stageRuns).where(eq(stageRuns.dossierId, dossier.id));

    const documentIdsByLocalId: Record<string, string> = {};

    if (input.documents.length > 0) {
      const inserted = await tx
        .insert(documents)
        .values(
          input.documents.map((doc) => ({
            dossierId: dossier.id,
            filename: doc.filename,
            storagePath: doc.storagePath,
            mimeType: doc.mimeType,
            byteSize: doc.byteSize,
            sha256: doc.sha256,
            classifiedType: doc.classifiedType,
            classificationConfidence: doc.classificationConfidence,
            pageCount: doc.pageCount,
            content: doc.content ?? null,
          })),
        )
        .returning({ id: documents.id });

      // `returning` preserves the order of the values it was given, which is
      // what ties each new UUID back to the local id it came from.
      input.documents.forEach((doc, index) => {
        documentIdsByLocalId[doc.localId] = inserted[index].id;
      });

      const fieldRows = input.documents.flatMap((doc) =>
        doc.fields.map((field) => ({
          documentId: documentIdsByLocalId[doc.localId],
          field: field.field,
          rawValue: field.rawValue,
          normalizedValue: field.normalizedValue,
          confidence: field.confidence,
          page: field.page,
          bbox: field.bbox,
          needsReview: field.needsReview,
        })),
      );

      if (fieldRows.length > 0) await tx.insert(extractedFields).values(fieldRows);
    }

    if (input.report.requirements.length > 0) {
      await tx.insert(requirementResults).values(
        input.report.requirements.map((requirement) => ({
          dossierId: dossier.id,
          requirement: requirement.requirement,
          status: requirement.status,
          detail: requirement.detail,
          evidence: requirement.evidence
            // Evidence naming a document that was not stored would produce a
            // dead link in the UI, so it is dropped rather than persisted.
            .filter((item) => documentIdsByLocalId[item.documentId] !== undefined)
            .map((item) => ({
              documentId: documentIdsByLocalId[item.documentId],
              field: item.field,
              page: item.page,
              bbox: item.bbox,
            })),
        })),
      );
    }

    const runs = input.stageRuns ?? [];
    if (runs.length > 0) {
      await tx.insert(stageRuns).values(
        runs.map((run) => ({
          dossierId: dossier.id,
          documentId:
            run.localDocumentId === undefined
              ? null
              : (documentIdsByLocalId[run.localDocumentId] ?? null),
          stage: run.stage,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt ?? null,
          durationMs: run.durationMs ?? null,
          model: run.model ?? null,
          inputTokens: run.inputTokens ?? null,
          outputTokens: run.outputTokens ?? null,
          costUsd: run.costUsd ?? null,
          output: run.output ?? null,
          error: run.error ?? null,
        })),
      );
    }

    return {
      dossierId: dossier.id,
      documentIdsByLocalId,
      requirementCount: input.report.requirements.length,
    };
  });
}

/* ------------------------------------------------------------------ reads -- */

/**
 * A document's metadata, without its bytes.
 *
 * `content` is deliberately absent. It is megabytes per dossier and no page
 * renders it — the routes that serve a file fetch it by id on its own. Selecting
 * it here would pull the whole dossier's files through the connection on every
 * page view to display a filename.
 */
export type DocumentMeta = Omit<Document, "content">;

export interface LoadedDocument {
  document: DocumentMeta;
  fields: ExtractedField[];
}

export interface LoadedDossier {
  dossier: Dossier;
  documents: LoadedDocument[];
  requirements: RequirementResult[];
  stageRuns: StageRun[];
}

export async function loadDossier(externalId: string): Promise<LoadedDossier | null> {
  const [dossier] = await db()
    .select()
    .from(dossiers)
    .where(eq(dossiers.externalId, externalId))
    .limit(1);

  if (dossier === undefined) return null;

  const documentRows = await db()
    .select({
      id: documents.id,
      dossierId: documents.dossierId,
      filename: documents.filename,
      storagePath: documents.storagePath,
      mimeType: documents.mimeType,
      byteSize: documents.byteSize,
      sha256: documents.sha256,
      classifiedType: documents.classifiedType,
      classificationConfidence: documents.classificationConfidence,
      pageCount: documents.pageCount,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.dossierId, dossier.id))
    .orderBy(documents.filename);

  const documentIds = documentRows.map((row) => row.id);

  const fieldRows =
    documentIds.length === 0
      ? []
      : await db()
          .select()
          .from(extractedFields)
          .where(inArray(extractedFields.documentId, documentIds))
          .orderBy(extractedFields.field);

  const [requirements, runs] = await Promise.all([
    db()
      .select()
      .from(requirementResults)
      .where(eq(requirementResults.dossierId, dossier.id))
      .orderBy(requirementResults.requirement),
    db()
      .select()
      .from(stageRuns)
      .where(eq(stageRuns.dossierId, dossier.id))
      .orderBy(stageRuns.startedAt),
  ]);

  return {
    dossier,
    documents: documentRows.map((document) => ({
      document,
      fields: fieldRows.filter((field) => field.documentId === document.id),
    })),
    requirements,
    stageRuns: runs,
  };
}

export interface DossierSummary {
  id: string;
  externalId: string;
  referenceDate: string;
  overallStatus: RequirementStatus | null;
  documentCount: number;
  needsReviewCount: number;
  createdAt: Date;
}

/** Newest first, which is the order the index page shows them in. */
export async function listDossiers(): Promise<DossierSummary[]> {
  const rows = await db().select().from(dossiers).orderBy(desc(dossiers.createdAt));
  if (rows.length === 0) return [];

  const documentRows = await db()
    .select({ id: documents.id, dossierId: documents.dossierId })
    .from(documents)
    .where(inArray(documents.dossierId, rows.map((row) => row.id)));

  const reviewRows = await db()
    .select({ documentId: extractedFields.documentId })
    .from(extractedFields)
    .where(eq(extractedFields.needsReview, true));

  const dossierIdByDocument = new Map(documentRows.map((row) => [row.id, row.dossierId]));

  const documentCounts = new Map<string, number>();
  for (const row of documentRows) {
    documentCounts.set(row.dossierId, (documentCounts.get(row.dossierId) ?? 0) + 1);
  }

  const reviewCounts = new Map<string, number>();
  for (const row of reviewRows) {
    const dossierId = dossierIdByDocument.get(row.documentId);
    if (dossierId === undefined) continue;
    reviewCounts.set(dossierId, (reviewCounts.get(dossierId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    referenceDate: row.referenceDate,
    overallStatus: row.overallStatus,
    documentCount: documentCounts.get(row.id) ?? 0,
    needsReviewCount: reviewCounts.get(row.id) ?? 0,
    createdAt: row.createdAt,
  }));
}

export interface ReviewQueueEntry {
  dossierId: string;
  externalId: string;
  documentId: string;
  filename: string;
  classifiedType: ClassifiedType | null;
  field: string;
  rawValue: string | null;
  confidence: number;
  page: number | null;
  bbox: BBox | null;
}

/**
 * Every field a human still has to look at, lowest confidence first.
 *
 * Ordering by confidence rather than arrival puts the least trustworthy
 * extraction at the top, which is where a reviewer's attention is worth most.
 */
export async function listReviewQueue(): Promise<ReviewQueueEntry[]> {
  const rows = await db()
    .select({
      dossierId: dossiers.id,
      externalId: dossiers.externalId,
      documentId: documents.id,
      filename: documents.filename,
      classifiedType: documents.classifiedType,
      field: extractedFields.field,
      rawValue: extractedFields.rawValue,
      confidence: extractedFields.confidence,
      page: extractedFields.page,
      bbox: extractedFields.bbox,
    })
    .from(extractedFields)
    .innerJoin(documents, eq(extractedFields.documentId, documents.id))
    .innerJoin(dossiers, eq(documents.dossierId, dossiers.id))
    .where(eq(extractedFields.needsReview, true))
    .orderBy(extractedFields.confidence);

  return rows;
}

/**
 * One document's stored bytes, fetched on their own.
 *
 * Separate from `loadDossier` so that reading a dossier never carries its files,
 * and serving a file never carries the dossier.
 */
export async function loadDocumentContent(
  documentId: string,
): Promise<{ storagePath: string; mimeType: string; content: Buffer | null } | null> {
  const [row] = await db()
    .select({
      storagePath: documents.storagePath,
      mimeType: documents.mimeType,
      content: documents.content,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return row ?? null;
}

export async function deleteDossier(externalId: string): Promise<void> {
  await db().delete(dossiers).where(eq(dossiers.externalId, externalId));
}
