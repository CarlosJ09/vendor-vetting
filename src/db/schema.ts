/**
 * Database schema.
 *
 * Two requirements from the brief shape this design:
 *
 *  - §7 "persist intermediate output so a stage can be re-run without repeating
 *    the ones before it" — hence `stage_runs`, which stores each stage's output
 *    as JSON keyed by (dossier, document, stage) rather than only the final
 *    dossier verdict.
 *  - §9 "cost per dossier, latency p50/p95 per stage" — hence the duration,
 *    token and cost columns on `stage_runs`. Measuring these after the fact is
 *    impossible if they were never recorded per stage.
 *
 * Extracted values live in their own table rather than as a JSON blob on the
 * document, because the eval scores them field by field and the review queue
 * filters on confidence — both are queries, not document reads.
 */

import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { COMPLIANCE_STATUSES, DOCUMENT_TYPES } from "@/lib/domain/types";
import type { BBox } from "@/lib/domain/types";

/**
 * `bytea`, which drizzle-pg has no built-in helper for.
 *
 * `node-postgres` already hands back a Buffer for this type and accepts one on
 * the way in, so both directions are pass-through.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const documentTypeEnum = pgEnum("document_type", [...DOCUMENT_TYPES, "unknown"]);

export const complianceStatusEnum = pgEnum("compliance_status", COMPLIANCE_STATUSES);

export const requirementStatusEnum = pgEnum("requirement_status", [
  "pass",
  "warn",
  "fail",
  "needs_review",
]);

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "ingest",
  "render",
  "classify",
  "extract",
  "normalize",
  "validate",
  "cross_check",
  "dossier",
]);

export const stageStatusEnum = pgEnum("stage_status", ["ok", "error", "skipped"]);

export const dossiers = pgTable("dossiers", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Human-facing identifier, e.g. the synthetic corpus's `dossier-001`. */
  externalId: text("external_id").notNull(),

  /**
   * The date this dossier is evaluated as of.
   *
   * Stored per dossier rather than read from the clock so a re-run reproduces
   * the original verdict. Freshness is relative to this, never to `now()`.
   */
  referenceDate: text("reference_date").notNull(),

  overallStatus: requirementStatusEnum("overall_status"),

  /** Path of the ingested folder on local disk. */
  sourcePath: text("source_path").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("dossiers_external_id_idx").on(table.externalId)]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiers.id, { onDelete: "cascade" }),

  /** Original filename as ingested. Carries no type information by design. */
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),

  /** Content hash, used to detect the duplicate-document defect deterministically. */
  sha256: text("sha256").notNull(),

  /*
   * The file itself.
   *
   * `storagePath` alone was enough while everything ran on one machine, but a
   * deployed demo has no access to the developer's filesystem, and a dossier
   * whose evidence links all 410 is worse than no dossier. The whole synthetic
   * corpus is 5 MB, so this costs nothing and removes object storage — and its
   * credentials — from the deployment entirely.
   *
   * Nullable: rows written before this column existed have none, and the
   * document route falls back to reading `storagePath`.
   */
  content: bytea("content"),

  classifiedType: documentTypeEnum("classified_type"),
  classificationConfidence: doublePrecision("classification_confidence"),
  pageCount: integer("page_count"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("documents_dossier_idx").on(table.dossierId),
  index("documents_sha256_idx").on(table.sha256),
]);

export const extractedFields = pgTable("extracted_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),

  /** Field name within the document type's schema, e.g. `rnc`. */
  field: text("field").notNull(),

  /** Raw value exactly as the model reported it, before normalisation. */
  rawValue: text("raw_value"),

  /** Value after `normalize`; dates become `YYYY-MM-DD` here. */
  normalizedValue: text("normalized_value"),

  confidence: doublePrecision("confidence").notNull(),

  /** 1-indexed page the value was read from. */
  page: integer("page"),
  bbox: jsonb("bbox").$type<BBox | null>(),

  /** True when confidence fell below the threshold and a human must look. */
  needsReview: boolean("needs_review").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("extracted_fields_document_field_idx").on(table.documentId, table.field),
]);

/**
 * One row per requirement in the dossier view.
 *
 * `evidence` points back at the documents and fields that justify the verdict,
 * which is what the UI turns into a link to the exact page and region.
 */
export const requirementResults = pgTable("requirement_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiers.id, { onDelete: "cascade" }),

  /** Stable requirement key, e.g. `rnc_consistency` or `dgii_freshness`. */
  requirement: text("requirement").notNull(),
  status: requirementStatusEnum("status").notNull(),

  /** Human-readable explanation, produced by code and never by the model. */
  detail: text("detail").notNull(),

  evidence: jsonb("evidence").$type<
    { documentId: string; field: string; page: number | null; bbox: BBox | null }[]
  >(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("requirement_results_dossier_requirement_idx").on(table.dossierId, table.requirement),
]);

/**
 * Per-stage execution record: the resumability and observability backbone.
 *
 * `output` holds the stage's result so a later stage can be re-run against it
 * without repeating the LLM calls that produced it. Token and cost columns are
 * null for the purely deterministic stages.
 */
export const stageRuns = pgTable("stage_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(() => dossiers.id, { onDelete: "cascade" }),

  /** Null for stages that operate on the dossier as a whole. */
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),

  stage: pipelineStageEnum("stage").notNull(),
  status: stageStatusEnum("status").notNull(),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),

  /** Model identifier, when the stage called one. */
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  costUsd: doublePrecision("cost_usd"),

  output: jsonb("output"),
  error: text("error"),
}, (table) => [
  index("stage_runs_dossier_stage_idx").on(table.dossierId, table.stage),
  index("stage_runs_document_idx").on(table.documentId),
]);

export type Dossier = typeof dossiers.$inferSelect;
export type NewDossier = typeof dossiers.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ExtractedField = typeof extractedFields.$inferSelect;
export type NewExtractedField = typeof extractedFields.$inferInsert;
export type RequirementResult = typeof requirementResults.$inferSelect;
export type NewRequirementResult = typeof requirementResults.$inferInsert;
export type StageRun = typeof stageRuns.$inferSelect;
export type NewStageRun = typeof stageRuns.$inferInsert;
