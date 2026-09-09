import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { planDossier } from "@/synth/plan";
import { createRng } from "@/synth/random";
import { renderCedula } from "@/synth/render/cedula";
import {
  renderCertificacionDgii,
  renderRegistroMercantil,
} from "@/synth/render/certifications";

import { MAX_IMAGE_EDGE, fragmentsToText, renderImage, renderPdf } from "./render";
import type { TextFragment } from "./render";

/**
 * These tests build their own fixtures with the synthetic renderers rather than
 * reading `data/synthetic`, which is gitignored and may not exist.
 */

const plan = (seed: number) =>
  planDossier({ id: `d-${seed}`, seed, defectKinds: [], expiryWarningDays: 15 });

const bbox = (x: number, y: number, width = 0.1, height = 0.01) => ({ x, y, width, height });

describe("fragmentsToText", () => {
  it("returns an empty string for no fragments", () => {
    expect(fragmentsToText([])).toBe("");
  });

  it("groups fragments on the same line and orders them left to right", () => {
    const fragments: TextFragment[] = [
      { text: "Caribe", bbox: bbox(0.5, 0.2) },
      { text: "Razon social", bbox: bbox(0.1, 0.2) },
    ];
    // Separated by a tab because these sit in different columns; see COLUMN_GAP.
    expect(fragmentsToText(fragments)).toBe("Razon social\tCaribe");
  });

  it("separates fragments on different lines", () => {
    const fragments: TextFragment[] = [
      { text: "segunda", bbox: bbox(0.1, 0.3) },
      { text: "primera", bbox: bbox(0.1, 0.2) },
    ];
    expect(fragmentsToText(fragments)).toBe("primera\nsegunda");
  });

  it("tolerates slight vertical drift within a line", () => {
    // Baselines rarely align to the pixel; a strict equality test would split
    // every label from its value.
    const fragments: TextFragment[] = [
      { text: "RNC", bbox: bbox(0.1, 0.2) },
      { text: "101850043", bbox: bbox(0.4, 0.2004) },
    ];
    expect(fragmentsToText(fragments)).toBe("RNC\t101850043");
  });

  it("collapses runs of whitespace", () => {
    const fragments: TextFragment[] = [{ text: "  doble   espacio  ", bbox: bbox(0.1, 0.2) }];
    expect(fragmentsToText(fragments)).toBe("doble espacio");
  });

  it("separates columns with a tab so a label cannot merge into its value", () => {
    // Regression: collapsing the gutter to a space produced
    // "Empleador Servicios Punta Alta", and the extractor returned the label as
    // part of the company name, which then failed the cross-document check.
    const fragments: TextFragment[] = [
      { text: "Empleador", bbox: { x: 0.1, y: 0.2, width: 0.07, height: 0.01 } },
      { text: "Servicios Punta Alta", bbox: { x: 0.38, y: 0.2, width: 0.2, height: 0.01 } },
    ];

    expect(fragmentsToText(fragments)).toBe("Empleador\tServicios Punta Alta");
  });

  it("keeps adjacent words on the same line joined by a space", () => {
    const fragments: TextFragment[] = [
      { text: "Servicios", bbox: { x: 0.1, y: 0.2, width: 0.07, height: 0.01 } },
      { text: "Punta", bbox: { x: 0.175, y: 0.2, width: 0.04, height: 0.01 } },
    ];

    expect(fragmentsToText(fragments)).toBe("Servicios Punta");
  });
});

describe("renderPdf", () => {
  it("recovers the printed field values from the text layer", async () => {
    const dossier = plan(3);
    const document = dossier.documents.find((d) => d.type === "registro_mercantil");
    if (document?.type !== "registro_mercantil") throw new Error("no registro mercantil");

    const pdf = await renderRegistroMercantil(document, createRng(1));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    expect(rendered.pageCount).toBe(1);
    expect(rendered.needsOcr).toBe(false);
    expect(rendered.text).toContain(document.fields.rnc);
    expect(rendered.text).toContain(document.fields.numero_registro);
    expect(rendered.text).toContain(document.fields.representante_legal);
  }, 30_000);

  it("preserves accented characters", async () => {
    const dossier = plan(3);
    const document = dossier.documents.find((d) => d.type === "registro_mercantil");
    if (document?.type !== "registro_mercantil") throw new Error("no registro mercantil");

    const pdf = await renderRegistroMercantil(document, createRng(1));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    // The representative's name reliably carries diacritics from the name pool.
    expect(rendered.text).toContain(document.fields.representante_legal);
  }, 30_000);

  it("keeps a label and its value on one line", async () => {
    const dossier = plan(5);
    const document = dossier.documents.find((d) => d.type === "certificacion_dgii");
    if (document?.type !== "certificacion_dgii") throw new Error("no dgii");

    const pdf = await renderCertificacionDgii(document, createRng(2));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    const rncLine = rendered.text.split("\n").find((line) => line.startsWith("RNC\t"));
    expect(rncLine).toBe(`RNC\t${document.fields.rnc}`);
  }, 30_000);

  it("reports fragment positions in normalized top-left coordinates", async () => {
    const dossier = plan(3);
    const document = dossier.documents.find((d) => d.type === "registro_mercantil");
    if (document?.type !== "registro_mercantil") throw new Error("no registro mercantil");

    const pdf = await renderRegistroMercantil(document, createRng(1));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    for (const fragment of rendered.pages[0].fragments) {
      expect(fragment.bbox.x).toBeGreaterThanOrEqual(0);
      expect(fragment.bbox.x).toBeLessThanOrEqual(1);
      expect(fragment.bbox.y).toBeGreaterThanOrEqual(0);
      expect(fragment.bbox.y).toBeLessThanOrEqual(1);
    }

    // The institutional header sits above the signature block, and y grows
    // downward — the assertion that pins the coordinate flip.
    const header = rendered.pages[0].fragments.find((f) => f.text.includes("REPUBLICA"));
    const footer = rendered.pages[0].fragments.find((f) => f.text.includes("SINTETICO"));
    expect(header).toBeDefined();
    expect(footer).toBeDefined();
    expect(header!.bbox.y).toBeLessThan(footer!.bbox.y);
  }, 30_000);

  it("places the extracted RNC where the generator printed it", async () => {
    // Geometry has to survive the round trip, or citation accuracy is not a
    // measurable quantity.
    const dossier = plan(3);
    const document = dossier.documents.find((d) => d.type === "registro_mercantil");
    if (document?.type !== "registro_mercantil") throw new Error("no registro mercantil");

    const pdf = await renderRegistroMercantil(document, createRng(1));
    const rendered = await renderPdf(Buffer.from(pdf.bytes));

    const truth = pdf.citations.rnc;
    const fragment = rendered.pages[0].fragments.find((f) => f.text === document.fields.rnc);

    expect(fragment).toBeDefined();
    expect(Math.abs(fragment!.bbox.x - truth.bbox.x)).toBeLessThan(0.01);
    expect(Math.abs(fragment!.bbox.y - truth.bbox.y)).toBeLessThan(0.01);
  }, 30_000);

  it("flags a PDF with no text layer as needing OCR", async () => {
    // A cedula photo wrapped in a PDF container: valid PDF, nothing to read.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const empty = await doc.save();

    const rendered = await renderPdf(Buffer.from(empty));

    expect(rendered.needsOcr).toBe(true);
  }, 30_000);
});

describe("renderImage", () => {
  it("normalises a degraded cedula to a bounded JPEG", async () => {
    const dossier = plan(9);
    const document = dossier.documents.find((d) => d.type === "cedula");
    if (document?.type !== "cedula") throw new Error("no cedula");

    const source = await renderCedula(document, "2019-07-06");
    const rendered = await renderImage(source.bytes);

    expect(rendered.kind).toBe("image");
    expect(rendered.mimeType).toBe("image/jpeg");
    expect(Math.max(rendered.width, rendered.height)).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
  }, 60_000);

  it("does not enlarge an image that is already small", async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const rendered = await renderImage(small);

    expect(rendered.width).toBe(300);
    expect(rendered.height).toBe(200);
  }, 30_000);
});
