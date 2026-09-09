/**
 * Renders an `EvalReport` as the markdown table §9 requires committed to the
 * repo and reproduced in the README.
 *
 * The false-pass section comes first and is not folded into any average. If a
 * defective dossier was cleared, that is the headline, whatever the other
 * numbers say.
 */

import type { EvalReport } from "./run";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const ms = (value: number) => `${(value / 1000).toFixed(2)}s`;

export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  const date = report.generatedAt.slice(0, 10);

  lines.push(`# Eval run — ${date}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Provider | \`${report.provider}\` |`);
  lines.push(`| Text model | \`${report.textModel}\` |`);
  lines.push(`| Vision model | \`${report.visionModel}\` |`);
  for (const [model, quant] of Object.entries(report.quantization)) {
    if (quant) lines.push(`| Quantisation (\`${model}\`) | \`${quant}\` |`);
  }
  lines.push(`| Dossiers | ${report.dossierCount} |`);
  lines.push(`| Documents | ${report.documentCount} |`);
  lines.push(`| Generated | ${report.generatedAt} |`);
  lines.push("");

  /* ------------------------------------------------------------ headline -- */

  const { verdicts } = report;
  lines.push("## False passes");
  lines.push("");
  lines.push(
    "A defective dossier reported clean is the worst failure this system can produce: it tells a reviewer there is nothing to look at. It is reported on its own and never averaged into anything.",
  );
  lines.push("");
  lines.push(
    `**${verdicts.falsePasses.length} of ${verdicts.defectiveTotal} defective dossiers were reported as \`pass\` (${pct(verdicts.falsePassRate)}).**`,
  );
  lines.push("");
  if (verdicts.falsePasses.length > 0) {
    lines.push("| Dossier |");
    lines.push("|---|");
    for (const id of verdicts.falsePasses) lines.push(`| \`${id}\` |`);
    lines.push("");
  }

  /* ------------------------------------------------------------- verdicts -- */

  lines.push("## Dossier verdicts");
  lines.push("");
  lines.push(`Accuracy: **${pct(verdicts.accuracy)}** (${verdicts.agreed}/${verdicts.total})`);
  lines.push("");
  const verdictLabels = ["pass", "warn", "fail", "needs_review"];
  lines.push(`| expected \\ actual | ${verdictLabels.join(" | ")} |`);
  lines.push(`|---|${verdictLabels.map(() => "---").join("|")}|`);
  for (const expected of verdictLabels) {
    const row = verdictLabels.map((actual) => verdicts.matrix[expected]?.[actual] ?? 0);
    lines.push(`| **${expected}** | ${row.join(" | ")} |`);
  }
  lines.push("");

  /* ------------------------------------------------------- classification -- */

  const { classification } = report;
  lines.push("## Classification");
  lines.push("");
  lines.push(
    `Accuracy: **${pct(classification.accuracy)}** (${classification.correct}/${classification.total})`,
  );
  lines.push("");
  lines.push("| Document type | Correct | Total | Accuracy |");
  lines.push("|---|---:|---:|---:|");
  for (const [type, stats] of Object.entries(classification.perType)) {
    lines.push(`| \`${type}\` | ${stats.correct} | ${stats.total} | ${pct(stats.accuracy)} |`);
  }
  lines.push("");
  lines.push("### Confusion matrix");
  lines.push("");
  lines.push(`| expected \\ predicted | ${classification.labels.map((l) => `\`${l}\``).join(" | ")} |`);
  lines.push(`|---|${classification.labels.map(() => "---:").join("|")}|`);
  for (const expected of classification.labels) {
    if (!classification.matrix[expected]) continue;
    const row = classification.labels.map((p) => classification.matrix[expected][p] ?? 0);
    if (row.every((v) => v === 0)) continue;
    lines.push(`| **\`${expected}\`** | ${row.join(" | ")} |`);
  }
  lines.push("");

  /* ----------------------------------------------------------- extraction -- */

  lines.push("## Extraction");
  lines.push("");
  lines.push(
    "Precision is *when the model answered, was it right*. Recall is *of the fields present, how many did it get*. A field the model declined to answer counts as a miss, never as a wrong answer.",
  );
  lines.push("");

  for (const [type, metrics] of Object.entries(report.extractionByType)) {
    lines.push(`### \`${type}\``);
    lines.push("");
    lines.push("| Field | Precision | Recall | F1 | TP | FP | FN | Conf. correct | Conf. wrong |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const m of metrics) {
      lines.push(
        `| \`${m.field}\` | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.truePositives} | ${m.falsePositives} | ${m.falseNegatives} | ${m.meanConfidenceCorrect.toFixed(2)} | ${m.meanConfidenceIncorrect.toFixed(2)} |`,
      );
    }
    lines.push("");
  }

  /* -------------------------------------------------------------- latency -- */

  lines.push("## Latency");
  lines.push("");
  lines.push("| Stage | Calls | p50 | p95 | max |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [stage, summary] of Object.entries(report.latencyByStage)) {
    lines.push(
      `| \`${stage}\` | ${summary.count} | ${ms(summary.p50)} | ${ms(summary.p95)} | ${ms(summary.max)} |`,
    );
  }
  const perDossier = report.latencyPerDossier;
  lines.push(
    `| **per dossier** | ${perDossier.count} | ${ms(perDossier.p50)} | ${ms(perDossier.p95)} | ${ms(perDossier.max)} |`,
  );
  lines.push("");

  /* ----------------------------------------------------------------- cost -- */

  lines.push("## Cost");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---:|");
  lines.push(`| Input tokens | ${report.tokens.input.toLocaleString("en-US")} |`);
  lines.push(`| Output tokens | ${report.tokens.output.toLocaleString("en-US")} |`);
  lines.push(
    `| Tokens per dossier | ${Math.round((report.tokens.input + report.tokens.output) / Math.max(report.dossierCount, 1)).toLocaleString("en-US")} |`,
  );
  lines.push(`| Measured cost | $${report.cost.measuredUsd.toFixed(2)} |`);
  if (report.cost.projectedUsd !== null) {
    lines.push(`| Projected hosted cost | $${report.cost.projectedUsd.toFixed(4)} |`);
    lines.push(
      `| Projected per dossier | $${(report.cost.projectedUsd / Math.max(report.dossierCount, 1)).toFixed(4)} |`,
    );
  }
  lines.push("");
  lines.push(report.cost.rateNote);
  lines.push("");

  /* --------------------------------------------------------------- errors -- */

  if (report.errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    lines.push("| Dossier | File | Error |");
    lines.push("|---|---|---|");
    for (const error of report.errors) {
      lines.push(
        `| \`${error.dossierId}\` | \`${error.filename}\` | ${error.error.replace(/\|/g, "\\|").slice(0, 160)} |`,
      );
    }
    lines.push("");
  }

  /* ------------------------------------------------- per-dossier breakdown -- */

  const disagreements = report.dossiers.filter((d) => d.expectedVerdict !== d.actualVerdict);
  if (disagreements.length > 0) {
    lines.push("## Verdict disagreements");
    lines.push("");
    lines.push("| Dossier | Expected | Actual | Injected defects |");
    lines.push("|---|---|---|---|");
    for (const d of disagreements) {
      lines.push(
        `| \`${d.dossierId}\` | ${d.expectedVerdict} | ${d.actualVerdict} | ${d.defectKinds.join(", ") || "—"} |`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "All documents in this corpus are synthetic. This project has no affiliation with the DGCP or any government institution.",
  );
  lines.push("");

  return lines.join("\n");
}
