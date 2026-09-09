import { describe, expect, it } from "vitest";

import {
  buildConfusionMatrix,
  computeFieldMetrics,
  computeVerdictMetrics,
  percentile,
  summarizeLatency,
} from "./metrics";

describe("percentile", () => {
  it("returns a value that was actually observed", () => {
    // Nearest-rank, not interpolated: p50 of these is a real measurement.
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it("handles p95 on a small sample", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("returns the single value for a one-element sample", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("returns 0 for an empty sample", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("is insensitive to input order", () => {
    expect(percentile([30, 10, 40, 20], 50)).toBe(percentile([10, 20, 30, 40], 50));
  });
});

describe("summarizeLatency", () => {
  it("summarises a sample", () => {
    const summary = summarizeLatency([100, 200, 300, 400]);
    expect(summary).toEqual({ count: 4, p50: 200, p95: 400, min: 100, max: 400, totalMs: 1000 });
  });

  it("handles an empty sample without dividing by zero", () => {
    expect(summarizeLatency([])).toEqual({
      count: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
      totalMs: 0,
    });
  });
});

describe("buildConfusionMatrix", () => {
  const labels = ["registro_mercantil", "certificacion_dgii", "cedula", "unknown"];

  it("counts a perfect classifier", () => {
    const result = buildConfusionMatrix(
      [
        { expected: "registro_mercantil", predicted: "registro_mercantil" },
        { expected: "cedula", predicted: "cedula" },
      ],
      labels,
    );

    expect(result.accuracy).toBe(1);
    expect(result.correct).toBe(2);
    expect(result.matrix.registro_mercantil.registro_mercantil).toBe(1);
  });

  it("records where mistakes went, not just that they happened", () => {
    const result = buildConfusionMatrix(
      [
        { expected: "certificacion_dgii", predicted: "certificacion_dgii" },
        { expected: "certificacion_dgii", predicted: "unknown" },
      ],
      labels,
    );

    expect(result.matrix.certificacion_dgii.unknown).toBe(1);
    expect(result.perType.certificacion_dgii).toEqual({ correct: 1, total: 2, accuracy: 0.5 });
  });

  it("returns zero accuracy for no observations rather than NaN", () => {
    expect(buildConfusionMatrix([], labels).accuracy).toBe(0);
  });
});

describe("computeFieldMetrics", () => {
  it("scores a field extracted correctly every time", () => {
    const [metrics] = computeFieldMetrics([
      { field: "rnc", expected: "101850043", actual: "101850043", confidence: 1 },
      { field: "rnc", expected: "131246796", actual: "131246796", confidence: 0.9 },
    ]);

    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.truePositives).toBe(2);
  });

  it("counts a wrong value as a false positive, not a miss", () => {
    const [metrics] = computeFieldMetrics([
      { field: "rnc", expected: "101850043", actual: "999999999", confidence: 0.8 },
    ]);

    expect(metrics.falsePositives).toBe(1);
    expect(metrics.falseNegatives).toBe(0);
    expect(metrics.precision).toBe(0);
  });

  it("counts an abstention as a miss, not a wrong answer", () => {
    const [metrics] = computeFieldMetrics([
      { field: "rnc", expected: "101850043", actual: "", confidence: 0.1 },
    ]);

    expect(metrics.falseNegatives).toBe(1);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.recall).toBe(0);
  });

  it("gives a model that abstains everywhere perfect precision and zero recall", () => {
    // Not a bug: it is the honest description of that behaviour, and the two
    // numbers together make it obvious.
    const [metrics] = computeFieldMetrics([
      { field: "rnc", expected: "101850043", actual: "", confidence: 0 },
      { field: "rnc", expected: "131246796", actual: "", confidence: 0 },
    ]);

    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
  });

  it("credits correctly abstaining on a genuinely absent field", () => {
    const [metrics] = computeFieldMetrics([
      { field: "codigo_verificacion", expected: "", actual: "", confidence: 0.2 },
    ]);

    expect(metrics.trueNegatives).toBe(1);
    expect(metrics.falsePositives).toBe(0);
  });

  it("separates confidence on correct answers from confidence on wrong ones", () => {
    // Whether these two numbers actually differ is the calibration question the
    // README has to answer honestly.
    const [metrics] = computeFieldMetrics([
      { field: "rnc", expected: "a", actual: "a", confidence: 0.9 },
      { field: "rnc", expected: "b", actual: "x", confidence: 0.7 },
    ]);

    expect(metrics.meanConfidenceCorrect).toBeCloseTo(0.9);
    expect(metrics.meanConfidenceIncorrect).toBeCloseTo(0.7);
  });

  it("reports each field separately and in a stable order", () => {
    const metrics = computeFieldMetrics([
      { field: "razon_social", expected: "a", actual: "a", confidence: 1 },
      { field: "rnc", expected: "b", actual: "b", confidence: 1 },
    ]);

    expect(metrics.map((m) => m.field)).toEqual(["razon_social", "rnc"]);
  });
});

describe("computeVerdictMetrics", () => {
  it("counts agreement", () => {
    const result = computeVerdictMetrics([
      { dossierId: "d1", expected: "pass", actual: "pass", defective: false },
      { dossierId: "d2", expected: "fail", actual: "fail", defective: true },
    ]);

    expect(result.accuracy).toBe(1);
    expect(result.falsePasses).toEqual([]);
  });

  it("isolates false passes from overall accuracy", () => {
    // A defective dossier reported clean is the worst outcome, and averaging it
    // away is exactly what this metric exists to prevent.
    const result = computeVerdictMetrics([
      { dossierId: "d1", expected: "pass", actual: "pass", defective: false },
      { dossierId: "d2", expected: "pass", actual: "pass", defective: false },
      { dossierId: "d3", expected: "fail", actual: "pass", defective: true },
    ]);

    expect(result.accuracy).toBeCloseTo(2 / 3);
    expect(result.falsePasses).toEqual(["d3"]);
    expect(result.falsePassRate).toBe(1);
  });

  it("does not count a defective dossier flagged as warn as a false pass", () => {
    const result = computeVerdictMetrics([
      { dossierId: "d1", expected: "fail", actual: "warn", defective: true },
    ]);

    expect(result.falsePasses).toEqual([]);
    expect(result.accuracy).toBe(0);
  });

  it("does not count a needs_review verdict as a false pass", () => {
    // Low confidence routes to a human, which is not the same as clearing it.
    const result = computeVerdictMetrics([
      { dossierId: "d1", expected: "fail", actual: "needs_review", defective: true },
    ]);

    expect(result.falsePasses).toEqual([]);
    expect(result.falsePassRate).toBe(0);
  });

  it("reports a zero false-pass rate when nothing was defective", () => {
    const result = computeVerdictMetrics([
      { dossierId: "d1", expected: "pass", actual: "pass", defective: false },
    ]);

    expect(result.falsePassRate).toBe(0);
    expect(result.defectiveTotal).toBe(0);
  });
});
