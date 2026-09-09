/**
 * Corpus generation: turns dossier plans into files on disk plus ground truth.
 *
 * The generated corpus is intentionally NOT committed. It is a pure function of
 * `(seed, count, defectiveRatio)`, so `pnpm synth` reproduces it byte for byte
 * on any machine — committing ~20 MB of derivable JPEGs would add weight without
 * adding information. The ground-truth files are written alongside the documents
 * so a dossier directory is self-describing.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { addDays } from "@/lib/dates";
import { EXPIRY_WARNING_DAYS } from "@/lib/config";
import type { DocumentType } from "@/lib/domain/types";

import { assignDefects, planDossier, type DossierPlan, type PlannedDocument } from "./plan";
import { createRng } from "./random";
import type { DefectKind } from "./scenarios";
import { renderCedula } from "./render/cedula";
import {
  renderCertificacionDgii,
  renderCertificacionTss,
  renderRegistroMercantil,
  type RenderedPdf,
} from "./render/certifications";
import type { FieldCitation } from "./render/pdf-layout";

export interface GenerateOptions {
  outDir: string;
  count: number;
  /** Fraction of dossiers carrying at least one defect. */
  defectiveRatio: number;
  seed: number;
  /** Remove `outDir` before writing. */
  clean: boolean;
}

export const DEFAULT_OPTIONS: Omit<GenerateOptions, "outDir"> = {
  count: 40,
  defectiveRatio: 0.4,
  seed: 20260615,
  clean: true,
};

/** Ground truth for one document, as written to disk. */
interface DocumentGroundTruth {
  filename: string;
  type: DocumentType;
  fields: Record<string, unknown>;
  /** Page and region each field was printed at, for scoring citations. */
  citations: Record<string, FieldCitation>;
}

interface DossierGroundTruth {
  id: string;
  seed: number;
  /** The date this dossier must be evaluated as of. See `plan.ts`. */
  referenceDate: string;
  expectedVerdict: DossierPlan["expectedVerdict"];
  company: { base: string; legalForm: string; full: string; city: string };
  representanteLegal: string;
  defects: DossierPlan["defects"];
  /** Warn-level conditions that are not injected defects. See `plan.ts`. */
  expectedWarnings: DossierPlan["expectedWarnings"];
  documents: DocumentGroundTruth[];
}

export interface CorpusSummary {
  seed: number;
  count: number;
  generatedAt: string;
  clean: number;
  defective: number;
  verdictCounts: Record<string, number>;
  defectCounts: Record<string, number>;
  dossiers: { id: string; expectedVerdict: string; defectKinds: string[] }[];
}

async function renderDocument(
  document: PlannedDocument,
): Promise<{ bytes: Uint8Array; citations: Record<string, FieldCitation> }> {
  // Seeded from the document itself, not its position, so a duplicated document
  // renders byte-identically to its original.
  const rng = createRng(document.renderSeed);

  switch (document.type) {
    case "registro_mercantil": {
      const rendered: RenderedPdf = await renderRegistroMercantil(document, rng);
      return { bytes: rendered.bytes, citations: rendered.citations };
    }
    case "certificacion_dgii": {
      const rendered = await renderCertificacionDgii(document, rng);
      return { bytes: rendered.bytes, citations: rendered.citations };
    }
    case "certificacion_tss": {
      const rendered = await renderCertificacionTss(document, rng);
      return { bytes: rendered.bytes, citations: rendered.citations };
    }
    case "cedula": {
      // The card's own issue date is cosmetic; deriving it from the expiry keeps
      // it plausible without adding another field to the plan.
      const issued = addDays(document.fields.fecha_vencimiento, -10 * 365);
      const rendered = await renderCedula(document, issued);
      // The cedula is a degraded photograph: there is no stable text geometry to
      // record, so extraction from it is scored on values and page only.
      return { bytes: rendered.bytes, citations: {} };
    }
  }
}

async function writeDossier(plan: DossierPlan, dossierDir: string): Promise<DossierGroundTruth> {
  await mkdir(dossierDir, { recursive: true });

  const documents: DocumentGroundTruth[] = [];

  for (const document of plan.documents) {
    const { bytes, citations } = await renderDocument(document);
    await writeFile(path.join(dossierDir, document.filename), bytes);

    documents.push({
      filename: document.filename,
      type: document.type,
      fields: { ...document.fields },
      citations,
    });
  }

  const groundTruth: DossierGroundTruth = {
    id: plan.id,
    seed: plan.seed,
    referenceDate: plan.referenceDate,
    expectedVerdict: plan.expectedVerdict,
    company: {
      base: plan.company.base,
      legalForm: plan.company.legalForm,
      full: plan.company.full,
      city: plan.company.city,
    },
    representanteLegal: plan.representanteLegal,
    defects: plan.defects,
    expectedWarnings: plan.expectedWarnings,
    documents,
  };

  await writeFile(
    path.join(dossierDir, "ground-truth.json"),
    `${JSON.stringify(groundTruth, null, 2)}\n`,
  );

  return groundTruth;
}

export async function generateCorpus(
  options: GenerateOptions,
  onProgress?: (done: number, total: number, id: string) => void,
): Promise<CorpusSummary> {
  if (options.clean) {
    await rm(options.outDir, { recursive: true, force: true });
  }
  await mkdir(options.outDir, { recursive: true });

  // Defect assignment is decided up front from the corpus seed: the split is
  // exact rather than approached in expectation, and every defect kind gets
  // comparable representation so per-defect eval numbers mean something.
  const selector = createRng(options.seed);
  const defectiveCount = Math.round(options.count * options.defectiveRatio);
  const assignments = assignDefects(selector, defectiveCount);
  const perDossier = selector.shuffle([
    ...assignments,
    ...Array.from({ length: options.count - assignments.length }, (): DefectKind[] => []),
  ]);

  const summaries: CorpusSummary["dossiers"] = [];
  const verdictCounts: Record<string, number> = {};
  const defectCounts: Record<string, number> = {};

  for (let i = 0; i < options.count; i++) {
    const id = `dossier-${String(i + 1).padStart(3, "0")}`;
    const plan = planDossier({
      id,
      seed: options.seed + i * 1013,
      defectKinds: perDossier[i],
      expiryWarningDays: EXPIRY_WARNING_DAYS,
    });

    await writeDossier(plan, path.join(options.outDir, id));

    verdictCounts[plan.expectedVerdict] = (verdictCounts[plan.expectedVerdict] ?? 0) + 1;
    for (const defect of plan.defects) {
      defectCounts[defect.kind] = (defectCounts[defect.kind] ?? 0) + 1;
    }
    summaries.push({
      id,
      expectedVerdict: plan.expectedVerdict,
      defectKinds: plan.defects.map((d) => d.kind),
    });

    onProgress?.(i + 1, options.count, id);
  }

  const summary: CorpusSummary = {
    seed: options.seed,
    count: options.count,
    generatedAt: new Date().toISOString(),
    clean: summaries.filter((d) => d.defectKinds.length === 0).length,
    defective: summaries.filter((d) => d.defectKinds.length > 0).length,
    verdictCounts,
    defectCounts,
    dossiers: summaries,
  };

  await writeFile(
    path.join(options.outDir, "index.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  return summary;
}
