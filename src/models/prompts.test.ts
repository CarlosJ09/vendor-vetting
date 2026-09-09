import { describe, expect, it } from "vitest";

import {
  CLASSIFY_INSTRUCTIONS,
  CLASSIFY_SYSTEM,
  EXTRACT_INSTRUCTIONS,
  EXTRACT_SYSTEM,
  textPrompt,
} from "./prompts";

/**
 * The architectural rule of this project (§3) is enforceable, so it is enforced.
 *
 * A prompt that asks the model whether a document is expired, valid, or
 * acceptable has moved a business rule out of tested code and into a model's
 * judgement. That is the single failure this project exists to demonstrate
 * avoiding, and "we were careful" is not a control.
 */

const ALL_PROMPTS = [
  ["CLASSIFY_SYSTEM", CLASSIFY_SYSTEM],
  ["CLASSIFY_INSTRUCTIONS", CLASSIFY_INSTRUCTIONS],
  ["EXTRACT_SYSTEM", EXTRACT_SYSTEM],
  ...Object.entries(EXTRACT_INSTRUCTIONS).map(
    ([type, text]) => [`EXTRACT_INSTRUCTIONS.${type}`, text] as const,
  ),
] as const;

/**
 * Words that would mean the model is being asked to judge rather than read.
 *
 * `vigencia` is deliberately absent: asking which date the document *states* it
 * is valid until is transcription. Asking whether it *is* still valid is not,
 * and that is what `vigente`/`vencido` would signal.
 */
const JUDGEMENT_TERMS = [
  "vencido",
  "vencida",
  "expirado",
  "expirada",
  "vigente",
  "válido",
  "valido",
  "inválido",
  "invalido",
  "aprobar",
  "aprueba",
  "rechazar",
  "rechaza",
  "cumple",
  "incumple",
  "correcto",
  "incorrecto",
  "verifica si",
  "comprueba si",
  "decide si",
  "evalúa si",
];

describe("prompt hygiene", () => {
  it.each(ALL_PROMPTS)("%s asks the model to read, not to judge", (_name, prompt) => {
    const haystack = prompt.toLowerCase();
    const found = JUDGEMENT_TERMS.filter((term) => haystack.includes(term));
    expect(found).toEqual([]);
  });

  it.each(ALL_PROMPTS)("%s never mentions a validity window or expiry rule", (_name, prompt) => {
    // The DGII/TSS validity window is a config constant. If it ever reaches a
    // prompt, the rule has escaped the tested code path.
    expect(prompt).not.toMatch(/\b\d+\s*d[ií]as\b/i);
    expect(prompt.toLowerCase()).not.toContain("ventana de validez");
  });

  it.each(ALL_PROMPTS)("%s never asks for cross-document comparison", (_name, prompt) => {
    const haystack = prompt.toLowerCase();
    expect(haystack).not.toContain("coincide");
    expect(haystack).not.toContain("compara");
    expect(haystack).not.toContain("otro documento");
  });

  it("keeps the status vocabulary aligned with the domain enum", () => {
    for (const type of ["certificacion_dgii", "certificacion_tss"]) {
      const prompt = EXTRACT_INSTRUCTIONS[type];
      expect(prompt).toContain("al_dia");
      expect(prompt).toContain("con_deuda");
      expect(prompt).toContain("indeterminado");
    }
  });

  it("instructs the model to abstain rather than guess", () => {
    expect(CLASSIFY_INSTRUCTIONS.toLowerCase()).toContain("unknown");
    expect(EXTRACT_SYSTEM.toLowerCase()).toContain("no inventes");
    expect(EXTRACT_INSTRUCTIONS.cedula.toLowerCase()).toContain("en lugar de adivinar");
  });

  it("provides instructions for every extractable document type", () => {
    expect(Object.keys(EXTRACT_INSTRUCTIONS).sort()).toEqual([
      "cedula",
      "certificacion_dgii",
      "certificacion_tss",
      "registro_mercantil",
    ]);
  });
});

describe("textPrompt", () => {
  it("delimits the document so instructions cannot be confused with content", () => {
    const prompt = textPrompt("Extrae el RNC.", "RNC 101850043");

    expect(prompt).toContain("Extrae el RNC.");
    expect(prompt).toContain("--- INICIO DEL DOCUMENTO ---");
    expect(prompt).toContain("RNC 101850043");
    expect(prompt).toContain("--- FIN DEL DOCUMENTO ---");
    expect(prompt.indexOf("Extrae el RNC.")).toBeLessThan(prompt.indexOf("RNC 101850043"));
  });
});
