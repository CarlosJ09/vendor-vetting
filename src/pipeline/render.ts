/**
 * Stage 2 — render.
 *
 * Turns an ingested file into whatever the model stages need to read it:
 *
 *  - **PDFs** yield a text layer, per page, with each fragment's position on the
 *    page. Text-based certifications carry a perfect transcription already, and
 *    rasterising them to make a vision model re-read it would throw away exact
 *    characters in exchange for OCR errors.
 *  - **Images** stay images. There is no text to recover, so they are only
 *    normalised for the vision model: downscaled to a sane width and re-encoded.
 *
 * Positions matter as much as the text. The dossier has to link each finding to
 * the exact region that supports it, and the synthetic corpus records
 * ground-truth bounding boxes, so citation accuracy is measurable — but only if
 * this stage preserves geometry.
 *
 * Coordinates are normalized to `[0, 1]` with the origin at the top-left, the
 * same convention as `BBox` everywhere else. PDF user space has its origin at
 * the bottom-left, so the flip happens here, once.
 */

import { createRequire } from "node:module";
import path from "node:path";

import sharp from "sharp";

import type { BBox } from "@/lib/domain/types";

import type { IngestedFile } from "./ingest";

/** Longest edge, in pixels, an image is scaled to before reaching the model. */
export const MAX_IMAGE_EDGE = 1536;

export interface TextFragment {
  text: string;
  bbox: BBox;
}

export interface RenderedPage {
  /** 1-indexed. */
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  /** Reading-order text of the page, with line breaks reconstructed. */
  text: string;
  fragments: TextFragment[];
}

export interface RenderedPdf {
  kind: "pdf";
  pageCount: number;
  pages: RenderedPage[];
  /** Concatenated page text, separated by form feeds. */
  text: string;
  /** True when the PDF carries no usable text layer and needs OCR instead. */
  needsOcr: boolean;
}

export interface RenderedImage {
  kind: "image";
  /** Normalised image bytes, ready to be base64-encoded for a vision model. */
  bytes: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export type RenderedDocument = RenderedPdf | RenderedImage;

/**
 * Below this many characters a PDF is treated as having no real text layer.
 *
 * Scanned documents wrapped in a PDF container are common in real intake and
 * often carry a few stray characters, so "zero characters" is too strict a test.
 */
const MIN_TEXT_LAYER_CHARS = 40;

/**
 * Load pdfjs lazily.
 *
 * It is an ESM-only, browser-oriented package; importing it at module scope
 * pulls it into every consumer of this file, including ones that only handle
 * images.
 */
async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * Filesystem location of the Type1 standard fonts bundled with pdfjs.
 *
 * Without it pdfjs warns on every page that uses Helvetica or Times — which is
 * every certification this project generates. Resolved from the installed
 * package rather than hardcoded, so it survives hoisting differences between
 * package managers.
 */
function standardFontDataUrl(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("pdfjs-dist/package.json");
  // pdfjs requires a trailing separator; it concatenates the filename directly.
  return `${path.join(path.dirname(packageJson), "standard_fonts")}${path.sep}`;
}

/** Convert a pdfjs text item's transform into a normalized top-left bbox. */
function toBBox(
  transform: number[],
  itemWidth: number,
  itemHeight: number,
  pageWidth: number,
  pageHeight: number,
): BBox {
  // transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]; the
  // last two are the glyph origin, which sits on the text baseline.
  const [, , , , x, baselineY] = transform;

  // pdfjs reports height as the font size, so the ascender sits roughly at the
  // baseline plus that height. Flip to a top-down origin at the same time.
  const top = pageHeight - (baselineY + itemHeight);

  return {
    x: x / pageWidth,
    y: top / pageHeight,
    width: itemWidth / pageWidth,
    height: itemHeight / pageHeight,
  };
}

export async function renderPdf(bytes: Buffer): Promise<RenderedPdf> {
  const pdfjs = await loadPdfjs();

  const loadingTask = pdfjs.getDocument({
    // pdfjs mutates the buffer it is handed, so it gets a copy.
    data: new Uint8Array(bytes),
    // Running headless: don't go looking for system font files, use the ones
    // pdfjs ships with instead.
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
  });

  const document = await loadingTask.promise;
  const pages: RenderedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const fragments: TextFragment[] = [];

      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;

        fragments.push({
          text: item.str,
          bbox: toBBox(item.transform, item.width, item.height, viewport.width, viewport.height),
        });
      }

      pages.push({
        pageNumber,
        widthPt: viewport.width,
        heightPt: viewport.height,
        text: fragmentsToText(fragments),
        fragments,
      });

      page.cleanup();
    }
  } finally {
    // `destroy` lives on the loading task in pdfjs 6, not on the document proxy.
    await loadingTask.destroy();
  }

  const text = pages.map((page) => page.text).join("\n\f\n");

  return {
    kind: "pdf",
    pageCount: pages.length,
    pages,
    text,
    needsOcr: text.replace(/\s/g, "").length < MIN_TEXT_LAYER_CHARS,
  };
}

/**
 * Reassemble fragments into readable lines.
 *
 * pdfjs emits text in drawing order with no line structure, and a labelled
 * field block collapses into an unreadable run without this. Fragments are
 * grouped by vertical position, then ordered left to right.
 */
export function fragmentsToText(fragments: TextFragment[]): string {
  if (fragments.length === 0) return "";

  // Tolerance for treating two fragments as sharing a line, as a fraction of
  // page height. Generous enough to absorb sub/superscript drift.
  const lineTolerance = 0.006;

  const sorted = [...fragments].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

  const lines: TextFragment[][] = [];
  for (const fragment of sorted) {
    const current = lines[lines.length - 1];
    const sameLine =
      current !== undefined &&
      Math.abs(current[0].bbox.y - fragment.bbox.y) <= lineTolerance;

    if (sameLine) current.push(fragment);
    else lines.push([fragment]);
  }

  return lines
    .map((line) => joinLine([...line].sort((a, b) => a.bbox.x - b.bbox.x)))
    .filter(Boolean)
    .join("\n");
}

/**
 * Horizontal gap, as a fraction of page width, above which two fragments are
 * treated as separate columns rather than adjacent words.
 *
 * These documents lay out fields as `Label      Value` with the value at a fixed
 * indent. Collapsing that gap to a single space erased the distinction and the
 * extractor once returned "Empleador Servicios Punta Alta, E.I.R.L." — label
 * included — which then failed the cross-document name check. A word space at
 * 11pt is well under 1% of a 595pt page; a column gutter here is over 15%.
 */
const COLUMN_GAP = 0.02;

function joinLine(fragments: TextFragment[]): string {
  let out = "";

  for (const [index, fragment] of fragments.entries()) {
    if (index === 0) {
      out = fragment.text;
      continue;
    }

    const previous = fragments[index - 1];
    const gap = fragment.bbox.x - (previous.bbox.x + previous.bbox.width);

    // A tab keeps the columns distinguishable to a reader — human or model —
    // without inventing punctuation that could be mistaken for document content.
    out += (gap > COLUMN_GAP ? "\t" : " ") + fragment.text;
  }

  return out.replace(/[ ]+/g, " ").replace(/[ ]*\t[ ]*/g, "\t").trim();
}

/**
 * Normalise an image for the vision model.
 *
 * Deliberately does NOT try to repair the scan — no deskew, no denoise, no
 * contrast stretch. Those would be plausible additions, but they would also
 * quietly become an untested preprocessing pipeline whose contribution to the
 * final numbers nobody could separate. Start honest; add preprocessing later
 * only if the eval shows it earns its place.
 */
export async function renderImage(bytes: Buffer): Promise<RenderedImage> {
  const pipeline = sharp(bytes)
    .rotate() // honours any EXIF orientation flag
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true });

  const output = await pipeline.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });

  return {
    kind: "image",
    bytes: output.data,
    mimeType: "image/jpeg",
    width: output.info.width,
    height: output.info.height,
  };
}

/** Render an ingested file according to its detected kind. */
export async function renderDocument(file: IngestedFile, bytes: Buffer): Promise<RenderedDocument> {
  return file.kind === "pdf" ? renderPdf(bytes) : renderImage(bytes);
}
