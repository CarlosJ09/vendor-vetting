/**
 * Metric definitions for the evaluation harness.
 *
 * Kept separate from the runner so the arithmetic is unit-testable without
 * standing up a model. Every number the README publishes is computed here, and
 * a metric nobody can reproduce by hand is not worth publishing.
 */

import type { ClassifiedType, DocumentType } from "@/lib/domain/types";

/* ------------------------------------------------------------- percentiles -- */

/**
 * Nearest-rank percentile.
 *
 * Chosen over interpolation because it always returns a latency that was
 * actually observed. "p95 = 3.7s" should name a real request, not a number
 * halfway between two of them.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  totalMs: number;
}

export function summarizeLatency(values: number[]): LatencySummary {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    totalMs: values.reduce((sum, v) => sum + v, 0),
  };
}

/* --------------------------------------------------------- classification -- */

export interface ConfusionMatrix {
  /** `matrix[expected][predicted]` counts. */
  matrix: Record<string, Record<string, number>>;
  labels: string[];
  correct: number;
  total: number;
  accuracy: number;
  perType: Record<string, { correct: number; total: number; accuracy: number }>;
}

export function buildConfusionMatrix(
  pairs: { expected: DocumentType; predicted: ClassifiedType }[],
  labels: string[],
): ConfusionMatrix {
  const matrix: Record<string, Record<string, number>> = {};
  for (const expected of labels) {
    matrix[expected] = Object.fromEntries(labels.map((predicted) => [predicted, 0]));
  }

  const perType: ConfusionMatrix["perType"] = {};

  for (const { expected, predicted } of pairs) {
    matrix[expected] ??= Object.fromEntries(labels.map((l) => [l, 0]));
    matrix[expected][predicted] = (matrix[expected][predicted] ?? 0) + 1;

    perType[expected] ??= { correct: 0, total: 0, accuracy: 0 };
    perType[expected].total += 1;
    if (expected === predicted) perType[expected].correct += 1;
  }

  for (const stats of Object.values(perType)) {
    stats.accuracy = stats.total === 0 ? 0 : stats.correct / stats.total;
  }

  const correct = pairs.filter((p) => p.expected === p.predicted).length;

  return {
    matrix,
    labels,
    correct,
    total: pairs.length,
    accuracy: pairs.length === 0 ? 0 : correct / pairs.length,
    perType,
  };
}

/* ------------------------------------------------------------- extraction -- */

/**
 * Per-field extraction quality.
 *
 * Precision and recall are defined against "the model produced a value":
 *
 *  - **true positive** — a value was produced and it matches ground truth
 *  - **false positive** — a value was produced and it does not match
 *  - **false negative** — no value was produced where one exists
 *
 * So precision answers "when it answered, was it right", and recall answers
 * "of the fields that were there, how many did it get". A model that abstains
 * everywhere scores perfect precision and zero recall, which is the honest
 * description of that behaviour rather than a way to hide it.
 */
export interface FieldMetrics {
  field: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Fields where ground truth is also empty and the model correctly abstained. */
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** Mean confidence the model reported on correct extractions. */
  meanConfidenceCorrect: number;
  /** Mean confidence on incorrect ones. Should be lower, and often is not. */
  meanConfidenceIncorrect: number;
}

export interface FieldObservation {
  field: string;
  expected: string;
  actual: string;
  confidence: number;
}

export function computeFieldMetrics(observations: FieldObservation[]): FieldMetrics[] {
  const byField = new Map<string, FieldObservation[]>();
  for (const observation of observations) {
    byField.set(observation.field, [...(byField.get(observation.field) ?? []), observation]);
  }

  return [...byField.entries()]
    .map(([field, rows]) => {
      let truePositives = 0;
      let falsePositives = 0;
      let falseNegatives = 0;
      let trueNegatives = 0;

      const correctConfidences: number[] = [];
      const incorrectConfidences: number[] = [];

      for (const row of rows) {
        const produced = row.actual !== "";
        const expectedPresent = row.expected !== "";
        const matches = row.actual === row.expected;

        if (produced && matches) {
          truePositives += 1;
          correctConfidences.push(row.confidence);
        } else if (produced && !matches) {
          falsePositives += 1;
          incorrectConfidences.push(row.confidence);
        } else if (!produced && expectedPresent) {
          falseNegatives += 1;
          incorrectConfidences.push(row.confidence);
        } else {
          trueNegatives += 1;
        }
      }

      const precision =
        truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
      const recall =
        truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);

      return {
        field,
        truePositives,
        falsePositives,
        falseNegatives,
        trueNegatives,
        precision,
        recall,
        f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
        meanConfidenceCorrect: mean(correctConfidences),
        meanConfidenceIncorrect: mean(incorrectConfidences),
      };
    })
    .sort((a, b) => a.field.localeCompare(b.field));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/* --------------------------------------------------------------- verdicts -- */

export interface VerdictMetrics {
  total: number;
  agreed: number;
  accuracy: number;
  /** `matrix[expected][actual]`. */
  matrix: Record<string, Record<string, number>>;
  /**
   * Defective dossiers reported as clean.
   *
   * The worst failure mode this system has (§9): it is the case where a human
   * is told there is nothing to look at. Tracked on its own and never folded
   * into overall accuracy, where a good average could hide it.
   */
  falsePasses: string[];
  defectiveTotal: number;
  falsePassRate: number;
}

const VERDICTS = ["pass", "warn", "fail", "needs_review"] as const;

export function computeVerdictMetrics(
  rows: { dossierId: string; expected: string; actual: string; defective: boolean }[],
): VerdictMetrics {
  const matrix: Record<string, Record<string, number>> = {};
  for (const expected of VERDICTS) {
    matrix[expected] = Object.fromEntries(VERDICTS.map((actual) => [actual, 0]));
  }

  for (const row of rows) {
    matrix[row.expected] ??= Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    matrix[row.expected][row.actual] = (matrix[row.expected][row.actual] ?? 0) + 1;
  }

  const agreed = rows.filter((r) => r.expected === r.actual).length;
  const defective = rows.filter((r) => r.defective);
  const falsePasses = defective.filter((r) => r.actual === "pass").map((r) => r.dossierId);

  return {
    total: rows.length,
    agreed,
    accuracy: rows.length === 0 ? 0 : agreed / rows.length,
    matrix,
    falsePasses,
    defectiveTotal: defective.length,
    falsePassRate: defective.length === 0 ? 0 : falsePasses.length / defective.length,
  };
}
