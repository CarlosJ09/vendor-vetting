/**
 * Validation-decision accuracy against the synthetic corpus.
 *
 *   pnpm eval:validation
 *
 * This is the §9 metric "did the dossier get the right verdict", isolated from
 * extraction: ground-truth field values are fed straight into the rules at
 * confidence 1.0. Nothing here calls a model.
 *
 * Isolating it this way is the point. When the full pipeline later disagrees
 * with ground truth, this number tells you whether the rules or the extraction
 * are at fault. A rules layer that cannot score 100% here has a bug that no
 * amount of extraction quality will hide.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PlainDate } from "@/lib/dates";
import type { RequirementStatus } from "@/lib/domain/types";
import { validateDossier } from "@/lib/validation/dossier";
import type { ExtractedDocument } from "@/lib/validation/types";

const DEFAULT_CORPUS_DIR = "data/synthetic";

interface GroundTruthDocument {
  filename: string;
  type: ExtractedDocument["type"];
  fields: Record<string, unknown>;
}

interface GroundTruth {
  id: string;
  referenceDate: PlainDate;
  expectedVerdict: RequirementStatus;
  defects: { kind: string }[];
  expectedWarnings: { reason: string }[];
  documents: GroundTruthDocument[];
}

/** Wrap ground-truth values in the extraction envelope at full confidence. */
function asExtractedDocuments(groundTruth: GroundTruth): ExtractedDocument[] {
  return groundTruth.documents.map((document, index) => ({
    type: document.type,
    documentId: `${groundTruth.id}-${index}`,
    filename: document.filename,
    fields: Object.fromEntries(
      Object.entries(document.fields).map(([field, value]) => [
        field,
        { value, confidence: 1, page: 1 },
      ]),
    ),
  })) as ExtractedDocument[];
}

interface Row {
  id: string;
  expected: RequirementStatus;
  actual: RequirementStatus;
  agreed: boolean;
  defectKinds: string[];
  failingRequirements: string[];
}

export function runValidationEval(corpusDir: string): Row[] {
  const dossierDirs = readdirSync(corpusDir)
    .filter((entry) => entry.startsWith("dossier-"))
    .sort();

  if (dossierDirs.length === 0) {
    throw new Error(`No dossiers found in ${corpusDir}. Run \`pnpm synth\` first.`);
  }

  return dossierDirs.map((dir) => {
    const groundTruth = JSON.parse(
      readFileSync(path.join(corpusDir, dir, "ground-truth.json"), "utf8"),
    ) as GroundTruth;

    const report = validateDossier({
      referenceDate: groundTruth.referenceDate,
      documents: asExtractedDocuments(groundTruth),
    });

    return {
      id: groundTruth.id,
      expected: groundTruth.expectedVerdict,
      actual: report.overall,
      agreed: report.overall === groundTruth.expectedVerdict,
      defectKinds: groundTruth.defects.map((d) => d.kind),
      failingRequirements: report.requirements
        .filter((r) => r.status !== "pass")
        .map((r) => `${r.status}:${r.requirement}`),
    };
  });
}

function main(): void {
  const corpusDir = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_CORPUS_DIR);
  const rows = runValidationEval(corpusDir);

  const agreed = rows.filter((r) => r.agreed).length;

  /*
   * A defective dossier reported as clean is the worst possible outcome (§9),
   * so it is counted and printed separately rather than folded into accuracy.
   */
  const falsePasses = rows.filter(
    (r) => r.defectKinds.length > 0 && r.actual === "pass",
  );

  process.stdout.write("\nValidation-decision accuracy (ground-truth fields, no model)\n");
  process.stdout.write(`  corpus     ${corpusDir}\n`);
  process.stdout.write(`  dossiers   ${rows.length}\n`);
  process.stdout.write(
    `  agreement  ${agreed}/${rows.length} (${((agreed / rows.length) * 100).toFixed(1)}%)\n`,
  );
  process.stdout.write(
    `  FALSE PASS ${falsePasses.length}/${rows.filter((r) => r.defectKinds.length > 0).length} defective dossiers reported clean\n\n`,
  );

  const matrix = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.expected} -> ${row.actual}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
  }

  process.stdout.write("  expected -> actual\n");
  for (const [key, count] of [...matrix].sort()) {
    process.stdout.write(`    ${key.padEnd(28)} ${count}\n`);
  }

  const disagreements = rows.filter((r) => !r.agreed);
  if (disagreements.length > 0) {
    process.stdout.write("\n  disagreements\n");
    for (const row of disagreements) {
      process.stdout.write(
        `    ${row.id}  expected=${row.expected} actual=${row.actual} defects=[${row.defectKinds.join(",")}]\n`,
      );
      for (const requirement of row.failingRequirements) {
        process.stdout.write(`      ${requirement}\n`);
      }
    }
  }

  process.stdout.write("\n");
  process.exit(disagreements.length === 0 ? 0 : 1);
}

main();
