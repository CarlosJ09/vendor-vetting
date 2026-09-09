import { describe, expect, it } from "vitest";

import { planDossier } from "../plan";
import { renderCedula } from "./cedula";

/**
 * Reproducibility is a promise the generator makes: the corpus is not committed
 * because `pnpm synth` is supposed to recreate it byte for byte from a seed.
 *
 * That promise held for the PDFs and quietly failed for the cedulas, because
 * sharp's `create.noise` accepts no seed and libvips reseeded on every call.
 * These tests exist so it cannot regress silently again.
 */

const cedulaFrom = (seed: number) => {
  const plan = planDossier({ id: `d-${seed}`, seed, defectKinds: [], expiryWarningDays: 15 });
  const document = plan.documents.find((d) => d.type === "cedula");
  if (document?.type !== "cedula") throw new Error("planned dossier has no cedula");
  return document;
};

describe("renderCedula", () => {
  it("renders the same cedula to identical bytes across calls", async () => {
    const document = cedulaFrom(7);

    const first = await renderCedula(document, "2019-07-06");
    const second = await renderCedula(document, "2019-07-06");

    expect(first.bytes.equals(second.bytes)).toBe(true);
  }, 30_000);

  it("renders different grain for different noise seeds", async () => {
    const document = cedulaFrom(7);
    const reseeded = {
      ...document,
      degradation: { ...document.degradation, noiseSeed: document.degradation.noiseSeed + 1 },
    };

    const original = await renderCedula(document, "2019-07-06");
    const altered = await renderCedula(reseeded, "2019-07-06");

    expect(original.bytes.equals(altered.bytes)).toBe(false);
  }, 30_000);

  it("produces a non-empty JPEG", async () => {
    const rendered = await renderCedula(cedulaFrom(11), "2019-07-06");

    expect(rendered.bytes.length).toBeGreaterThan(1000);
    expect(rendered.bytes[0]).toBe(0xff);
    expect(rendered.bytes[1]).toBe(0xd8);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.height).toBeGreaterThan(0);
  }, 30_000);
});
