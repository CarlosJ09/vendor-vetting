/**
 * Integration tests against a real Postgres.
 *
 * These deliberately do not mock the database. The whole point of this layer is
 * that the schema, the cascades and the unique indexes behave as designed, and
 * a mock would assert only that the code calls the functions it calls.
 *
 * They skip — not fail — when no database is reachable, so `pnpm test` still
 * works on a checkout without Docker running. Run `pnpm db:up && pnpm db:migrate`
 * to exercise them.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateDossier } from "@/lib/validation/dossier";
import { cleanDossier, makeDocument } from "@/lib/validation/test-helpers";

import { closeDb, db, isReachable } from "./client";
import {
  deleteDossier,
  listDossiers,
  listReviewQueue,
  loadDocumentContent,
  loadDossier,
  persistDossierRun,
} from "./persist";
import { documents, dossiers, extractedFields, requirementResults, stageRuns } from "./schema";
import type { PersistInput } from "./persist";

const available = await isReachable();
const describeDb = available ? describe : describe.skip;

if (!available) {
  console.warn("[db] skipping persistence tests: no database at the configured URL");
}

const REFERENCE_DATE = "2026-06-15";

/** Build a persistable run from a set of extracted documents. */
function runFrom(externalId: string, extractedDocs = cleanDossier()): PersistInput {
  const report = validateDossier({ referenceDate: REFERENCE_DATE, documents: extractedDocs });

  return {
    externalId,
    referenceDate: REFERENCE_DATE,
    sourcePath: `/corpus/${externalId}`,
    report,
    documents: extractedDocs.map((doc, index) => ({
      localId: doc.documentId,
      filename: doc.filename,
      storagePath: `/corpus/${externalId}/${doc.filename}`,
      mimeType: doc.type === "cedula" ? "image/jpeg" : "application/pdf",
      byteSize: 1024 + index,
      sha256: `${externalId}-${index}`.padEnd(64, "0"),
      classifiedType: doc.type,
      classificationConfidence: 0.99,
      pageCount: 1,
      fields: Object.entries(doc.fields as Record<string, { value: unknown; confidence: number; page?: number }>).map(
        ([field, extracted]) => ({
          field,
          rawValue: String(extracted.value),
          normalizedValue: String(extracted.value),
          confidence: extracted.confidence,
          page: extracted.page ?? 1,
          bbox: null,
          needsReview: extracted.confidence < 0.75,
        }),
      ),
    })),
    stageRuns: [
      {
        stage: "classify",
        status: "ok",
        localDocumentId: extractedDocs[0].documentId,
        startedAt: new Date("2026-06-15T10:00:00Z"),
        finishedAt: new Date("2026-06-15T10:00:02Z"),
        durationMs: 2000,
        model: "qwen2.5:7b",
        inputTokens: 1200,
        outputTokens: 40,
        output: { type: "registro_mercantil" },
      },
      {
        stage: "validate",
        status: "ok",
        startedAt: new Date("2026-06-15T10:01:00Z"),
        finishedAt: new Date("2026-06-15T10:01:00Z"),
        durationMs: 3,
      },
    ],
  };
}

/*
 * Fixture dossiers, cleaned up before and after.
 *
 * Before, because a previous failed run must not decide this one's outcome.
 * After, because these share the database the app reads from: a leftover
 * `it-review` row shows up in the review queue as though a real document needed
 * a human, which is exactly the signal that must not be noise.
 */
const FIXTURE_IDS = [
  "it-basic",
  "it-rerun",
  "it-review",
  "it-cascade",
  "it-list-a",
  "it-list-b",
  "it-duplicate",
  "it-same-bytes",
  "it-content",
  "it-binary",
  "it-nocontent",
];

describeDb("persistDossierRun", () => {
  beforeAll(async () => {
    for (const id of FIXTURE_IDS) await deleteDossier(id);
  });

  afterAll(async () => {
    for (const id of FIXTURE_IDS) await deleteDossier(id);
    await closeDb();
  });

  it("round-trips a dossier with its documents, fields and requirements", async () => {
    const input = runFrom("it-basic");
    const { dossierId } = await persistDossierRun(input);

    const loaded = await loadDossier("it-basic");

    expect(loaded).not.toBeNull();
    expect(loaded!.dossier.id).toBe(dossierId);
    expect(loaded!.dossier.referenceDate).toBe(REFERENCE_DATE);
    expect(loaded!.dossier.overallStatus).toBe(input.report.overall);
    expect(loaded!.documents).toHaveLength(4);
    expect(loaded!.requirements).toHaveLength(input.report.requirements.length);

    // 6 + 5 + 4 + 4 fields across the four document types.
    const fieldCount = loaded!.documents.reduce((sum, d) => sum + d.fields.length, 0);
    expect(fieldCount).toBe(19);
  });

  it("stores the reference date as written, with no timezone drift", async () => {
    // The whole freshness layer is arithmetic on this string. A `date` column
    // round-tripped through a JS Date would shift it by a day west of UTC.
    const loaded = await loadDossier("it-basic");
    expect(loaded!.dossier.referenceDate).toBe("2026-06-15");
  });

  it("rewrites evidence document ids to database ids so the UI can link", async () => {
    const loaded = await loadDossier("it-basic");
    const dbIds = new Set(loaded!.documents.map((d) => d.document.id));

    const evidence = loaded!.requirements.flatMap((r) => r.evidence ?? []);
    expect(evidence.length).toBeGreaterThan(0);

    for (const item of evidence) {
      expect(dbIds).toContain(item.documentId);
    }
  });

  it("replaces a previous run of the same dossier instead of duplicating it", async () => {
    const first = await persistDossierRun(runFrom("it-rerun"));
    const second = await persistDossierRun(runFrom("it-rerun"));

    // Same external identity, so the row is reused rather than orphaned.
    expect(second.dossierId).toBe(first.dossierId);

    const rows = await db().select().from(dossiers).where(eq(dossiers.externalId, "it-rerun"));
    expect(rows).toHaveLength(1);

    const loaded = await loadDossier("it-rerun");
    expect(loaded!.documents).toHaveLength(4);
    expect(loaded!.requirements).toHaveLength(first.requirementCount);
  });

  it("surfaces low-confidence fields in the review queue", async () => {
    const docs = cleanDossier();
    docs[3] = makeDocument(
      "cedula",
      {
        cedula: "00113918205",
        nombre_completo: "José Ramírez Peña",
        fecha_nacimiento: "1985-04-12",
        fecha_vencimiento: "2030-01-01",
      },
      { fieldConfidence: { cedula: 0.4 } },
    );

    await persistDossierRun(runFrom("it-review", docs));

    const queue = await listReviewQueue();
    const mine = queue.filter((entry) => entry.externalId === "it-review");

    expect(mine).toHaveLength(1);
    expect(mine[0].field).toBe("cedula");
    expect(mine[0].confidence).toBeCloseTo(0.4);
    expect(mine[0].filename).toBeTruthy();
  });

  it("records stage runs with the timings and tokens the eval reports on", async () => {
    const loaded = await loadDossier("it-basic");
    const classify = loaded!.stageRuns.find((run) => run.stage === "classify");

    expect(classify).toBeDefined();
    expect(classify!.durationMs).toBe(2000);
    expect(classify!.inputTokens).toBe(1200);
    expect(classify!.model).toBe("qwen2.5:7b");
    // Stage output is what makes a re-run possible without new model calls.
    expect(classify!.output).toEqual({ type: "registro_mercantil" });
  });

  it("attaches document-scoped stage runs to the right document", async () => {
    const loaded = await loadDossier("it-basic");
    const classify = loaded!.stageRuns.find((run) => run.stage === "classify");
    const validate = loaded!.stageRuns.find((run) => run.stage === "validate");

    const documentIds = loaded!.documents.map((d) => d.document.id);
    expect(documentIds).toContain(classify!.documentId);
    // Dossier-wide stages have no document.
    expect(validate!.documentId).toBeNull();
  });

  it("cascades deletes to every child table", async () => {
    const { dossierId } = await persistDossierRun(runFrom("it-cascade"));
    await deleteDossier("it-cascade");

    const remainingDocs = await db().select().from(documents).where(eq(documents.dossierId, dossierId));
    const remainingReqs = await db()
      .select()
      .from(requirementResults)
      .where(eq(requirementResults.dossierId, dossierId));
    const remainingRuns = await db().select().from(stageRuns).where(eq(stageRuns.dossierId, dossierId));

    expect(remainingDocs).toEqual([]);
    expect(remainingReqs).toEqual([]);
    expect(remainingRuns).toEqual([]);

    // Extracted fields hang off documents, so they can only be checked by count.
    const orphanFields = await db()
      .select()
      .from(extractedFields)
      .innerJoin(documents, eq(extractedFields.documentId, documents.id))
      .where(eq(documents.dossierId, dossierId));
    expect(orphanFields).toEqual([]);
  });

  it("refuses to persist two documents sharing a local id", async () => {
    /*
     * Regression. Local ids were the content hash, so the corpus's deliberate
     * duplicate-document defect gave two files the same id; the id-to-UUID map
     * silently kept the last one and both documents' fields were written under
     * a single row, blowing up on the unique index several statements later.
     * A collision is a caller bug and it should say so at the point it happens.
     */
    const input = runFrom("it-duplicate");
    input.documents[1].localId = input.documents[0].localId;

    await expect(persistDossierRun(input)).rejects.toThrow(/duplicate local id/i);
  });

  it("stores two byte-identical documents as separate rows", async () => {
    // Same content, same sha256, different files: the duplicate-document
    // requirement can only fire if both actually reach the database.
    const input = runFrom("it-same-bytes");
    input.documents[1].sha256 = input.documents[0].sha256;

    await persistDossierRun(input);
    const loaded = await loadDossier("it-same-bytes");

    expect(loaded!.documents).toHaveLength(4);
    const matching = loaded!.documents.filter(
      (d) => d.document.sha256 === input.documents[0].sha256,
    );
    expect(matching).toHaveLength(2);
  });

  it("stores the document bytes so a deploy needs no filesystem", async () => {
    /*
     * The deployed demo has no access to the machine that ran the pipeline.
     * Without this the dossier renders but every evidence link 404s, which is
     * the one part of the UI that has to work.
     */
    const input = runFrom("it-content");
    input.documents[0].content = Buffer.from("%PDF-1.7 fixture", "utf8");

    await persistDossierRun(input);
    const loaded = await loadDossier("it-content");

    const stored = loaded!.documents.find(
      (entry) => entry.document.filename === input.documents[0].filename,
    );

    const content = await loadDocumentContent(stored!.document.id);

    expect(content!.content).not.toBeNull();
    expect(Buffer.from(content!.content!).toString("utf8")).toBe("%PDF-1.7 fixture");
  });

  it("does not carry document bytes when reading a dossier", async () => {
    /*
     * Regression guard. `loadDossier` once selected every column, so adding the
     * bytea column silently made each page view drag the dossier's whole set of
     * files through the connection in order to print a filename. Pages read
     * metadata; the routes that serve a file fetch its bytes on their own.
     */
    const loaded = await loadDossier("it-content");

    for (const entry of loaded!.documents) {
      expect(entry.document).not.toHaveProperty("content");
    }
  });

  it("round-trips bytes that are not valid text", async () => {
    // A JPEG is not UTF-8. Anything that stringifies on the way through would
    // corrupt every scanned cedula in the corpus.
    const raw = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const input = runFrom("it-binary");
    input.documents[0].content = raw;

    await persistDossierRun(input);
    const loaded = await loadDossier("it-binary");
    const stored = loaded!.documents.find(
      (entry) => entry.document.filename === input.documents[0].filename,
    );

    const content = await loadDocumentContent(stored!.document.id);

    expect(Buffer.from(content!.content!).equals(raw)).toBe(true);
  });

  it("leaves content null when the caller supplies none", async () => {
    await persistDossierRun(runFrom("it-nocontent"));
    const loaded = await loadDossier("it-nocontent");

    for (const entry of loaded!.documents) {
      const content = await loadDocumentContent(entry.document.id);
      expect(content!.content).toBeNull();
    }
  });

  it("lists dossiers newest first with their verdict and counts", async () => {
    await persistDossierRun(runFrom("it-list-a"));
    await persistDossierRun(runFrom("it-list-b"));

    const listed = await listDossiers();
    const mine = listed.filter((d) => d.externalId.startsWith("it-list-"));

    expect(mine.map((d) => d.externalId)).toEqual(["it-list-b", "it-list-a"]);
    expect(mine[0].documentCount).toBe(4);
    expect(mine[0].overallStatus).toBeTruthy();
  });
});
