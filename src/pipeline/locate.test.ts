/**
 * Tests for the citation locator.
 *
 * Written before the implementation, per §12. The cases that matter are the
 * awkward ones: a value split across fragments by the PDF writer, a value that
 * shares a line with its label, and a value that simply is not on the page.
 */

import { describe, expect, it } from "vitest";

import { locateValue } from "./locate";
import type { RenderedPage } from "./render";

const fragment = (text: string, x: number, y: number, width: number) => ({
  text,
  bbox: { x, y, width, height: 0.016 },
});

function page(fragments: ReturnType<typeof fragment>[]): RenderedPage {
  return {
    pageNumber: 1,
    widthPt: 595,
    heightPt: 842,
    text: "",
    fragments,
  };
}

describe("locateValue", () => {
  it("returns null when there are no pages", () => {
    expect(locateValue([], "101850043")).toBeNull();
  });

  it("returns null for an empty search value", () => {
    const pages = [page([fragment("101850043", 0.4, 0.3, 0.09)])];
    expect(locateValue(pages, "")).toBeNull();
  });

  it("finds a value that is exactly one fragment", () => {
    const pages = [page([fragment("RNC", 0.1, 0.3, 0.04), fragment("101850043", 0.4, 0.3, 0.09)])];

    const found = locateValue(pages, "101850043");

    expect(found).not.toBeNull();
    expect(found!.page).toBe(1);
    expect(found!.bbox.x).toBeCloseTo(0.4);
    expect(found!.bbox.width).toBeCloseTo(0.09);
  });

  it("does not return the label fragment that sits beside the value", () => {
    const pages = [page([fragment("RNC", 0.1, 0.3, 0.04), fragment("101850043", 0.4, 0.3, 0.09)])];

    expect(locateValue(pages, "101850043")!.bbox.x).toBeCloseTo(0.4);
  });

  it("spans consecutive fragments when the writer split the value", () => {
    // pdf-lib and most producers emit a styled run per fragment, so a company
    // name routinely arrives in pieces.
    const pages = [
      page([
        fragment("Razón social", 0.1, 0.3, 0.11),
        fragment("Constructora del", 0.4, 0.3, 0.14),
        fragment("Caribe, S.R.L.", 0.55, 0.3, 0.12),
      ]),
    ];

    const found = locateValue(pages, "Constructora del Caribe, S.R.L.");

    expect(found).not.toBeNull();
    expect(found!.bbox.x).toBeCloseTo(0.4);
    // The union runs from the start of the first piece to the end of the last.
    expect(found!.bbox.width).toBeCloseTo(0.27, 2);
  });

  it("does not span across a line break", () => {
    const pages = [
      page([fragment("Constructora del", 0.4, 0.3, 0.14), fragment("Caribe", 0.4, 0.36, 0.06)]),
    ];

    expect(locateValue(pages, "Constructora del Caribe")).toBeNull();
  });

  it("matches regardless of case and accents", () => {
    // The extractor transcribes what it reads, but a normalised value may reach
    // the locator with its diacritics already folded.
    const pages = [page([fragment("José Ramírez Peña", 0.4, 0.3, 0.18)])];

    expect(locateValue(pages, "JOSE RAMIREZ PENA")).not.toBeNull();
  });

  it("reports the page the value was found on", () => {
    const second: RenderedPage = { ...page([fragment("404749", 0.4, 0.2, 0.06)]), pageNumber: 2 };
    const pages = [page([fragment("nada", 0.1, 0.1, 0.04)]), second];

    expect(locateValue(pages, "404749")!.page).toBe(2);
  });

  it("returns null when the value is not on the page", () => {
    const pages = [page([fragment("101850043", 0.4, 0.3, 0.09)])];
    expect(locateValue(pages, "999999999")).toBeNull();
  });

  it("finds a value embedded inside a longer fragment", () => {
    const pages = [page([fragment("Expedida el 10/01/2026 en Santo Domingo", 0.1, 0.5, 0.5)])];

    const found = locateValue(pages, "10/01/2026");

    expect(found).not.toBeNull();
    // Without glyph metrics the whole fragment is the honest answer; narrowing
    // it would mean inventing a position.
    expect(found!.bbox.width).toBeCloseTo(0.5);
    expect(found!.approximate).toBe(true);
  });

  it("marks an exact single-fragment hit as not approximate", () => {
    const pages = [page([fragment("101850043", 0.4, 0.3, 0.09)])];
    expect(locateValue(pages, "101850043")!.approximate).toBe(false);
  });
});

/**
 * Measured against the generator's own recorded citations.
 *
 * The synthetic renderers know exactly where they drew each value, so this
 * checks the locator against a truth it cannot see rather than against a
 * hand-written fixture. It is the same comparison the eval makes, run without
 * needing a model.
 */
describe("locateValue against generated documents", () => {
  it("recovers the region the generator printed each field in", async () => {
    const { planDossier } = await import("@/synth/plan");
    const { createRng } = await import("@/synth/random");
    const { renderRegistroMercantil } = await import("@/synth/render/certifications");
    const { renderPdf } = await import("./render");

    const dossier = planDossier({ id: "loc-1", seed: 7, defectKinds: [], expiryWarningDays: 15 });
    const document = dossier.documents.find((d) => d.type === "registro_mercantil");
    if (document?.type !== "registro_mercantil") throw new Error("no registro mercantil");

    const pdf = await renderRegistroMercantil(document, createRng(1));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    // Fields whose printed form is the stored form; dates are reformatted on
    // the page, so they are covered by the pipeline test instead.
    const fields = ["rnc", "numero_registro", "razon_social", "representante_legal"] as const;

    for (const field of fields) {
      const truth = pdf.citations[field];
      if (truth === undefined) continue;

      const found = locateValue(rendered.pages, document.fields[field]);

      expect(found, `no citation located for ${field}`).not.toBeNull();
      expect(found!.page).toBe(truth.page);
      expect(Math.abs(found!.bbox.x - truth.bbox.x), `${field} x`).toBeLessThan(0.02);
      expect(Math.abs(found!.bbox.y - truth.bbox.y), `${field} y`).toBeLessThan(0.02);
    }
  }, 30_000);
});
