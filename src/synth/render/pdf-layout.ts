/**
 * Layout primitives for the synthetic certifications.
 *
 * Beyond drawing, these helpers record the page and rectangle of every labelled
 * value they emit. That gives the corpus ground-truth *citations*, not just
 * ground-truth values, so the eval can score whether the extractor pointed at
 * the right region and not merely whether it guessed the right string.
 *
 * Coordinates: pdf-lib puts the origin at the bottom-left, but the pipeline and
 * the dossier UI both work top-left with normalized `[0, 1]` values. The
 * conversion happens here, once, at the point of recording.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

import type { BBox } from "@/lib/domain/types";

/** A4 in PDF points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

export const MARGIN = 64;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.08, 0.09, 0.11);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.75, 0.77, 0.8);

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
}

export async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
}

/** A recorded ground-truth citation for one field. */
export interface FieldCitation {
  /** 1-indexed page. */
  page: number;
  bbox: BBox;
}

/**
 * Accumulates citations while a document is drawn.
 *
 * Values rendered inside flowing prose (the compliance-status sentence) are
 * deliberately not recorded: their region depends on line wrapping, and a
 * citation covering half a paragraph would be a misleading target to score
 * against. Those fields get a page-level citation only.
 */
export class CitationRecorder {
  private readonly citations = new Map<string, FieldCitation>();

  record(field: string, page: number, rect: { x: number; yTop: number; width: number; height: number }): void {
    this.citations.set(field, {
      page,
      bbox: {
        x: rect.x / PAGE_WIDTH,
        y: rect.yTop / PAGE_HEIGHT,
        width: rect.width / PAGE_WIDTH,
        height: rect.height / PAGE_HEIGHT,
      },
    });
  }

  /** Record a page-only citation for a value with no stable rectangle. */
  recordPageOnly(field: string, page: number): void {
    this.citations.set(field, { page, bbox: { x: 0, y: 0, width: 1, height: 1 } });
  }

  toJSON(): Record<string, FieldCitation> {
    return Object.fromEntries(this.citations);
  }
}

/** Convert a pdf-lib baseline y into a top-down y for citation recording. */
function topFromBaseline(baselineY: number, size: number): number {
  // Approximate the glyph box as ascender-height above the baseline.
  return PAGE_HEIGHT - (baselineY + size * 0.75);
}

export interface TextOptions {
  x?: number;
  size?: number;
  font?: PDFFont;
  color?: ReturnType<typeof rgb>;
}

/** Split `text` into lines that fit `maxWidth` when drawn in `font` at `size`. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines;
}

/** Draw a wrapped paragraph, returning the baseline y left after the last line. */
export function drawParagraph(
  page: PDFPage,
  text: string,
  y: number,
  fonts: Fonts,
  options: { size?: number; lineHeight?: number; font?: PDFFont; align?: "left" | "justify" } = {},
): number {
  const size = options.size ?? 11;
  const lineHeight = options.lineHeight ?? size * 1.55;
  const font = options.font ?? fonts.serif;

  let cursor = y;
  for (const line of wrapText(text, font, size, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN, y: cursor, size, font, color: INK });
    cursor -= lineHeight;
  }

  return cursor;
}

/**
 * Draw a `Label: value` row and record the value's rectangle as a citation.
 *
 * The label column is fixed-width so the values line up, which is both how these
 * certifications actually look and what makes the recorded boxes tight.
 */
export function drawField(
  page: PDFPage,
  recorder: CitationRecorder,
  pageNumber: number,
  options: {
    label: string;
    value: string;
    field: string;
    y: number;
    fonts: Fonts;
    labelWidth?: number;
    size?: number;
  },
): number {
  const size = options.size ?? 11;
  const labelWidth = options.labelWidth ?? 165;
  const valueX = MARGIN + labelWidth;

  page.drawText(options.label, {
    x: MARGIN,
    y: options.y,
    size,
    font: options.fonts.regular,
    color: MUTED,
  });

  page.drawText(options.value, {
    x: valueX,
    y: options.y,
    size,
    font: options.fonts.bold,
    color: INK,
  });

  recorder.record(options.field, pageNumber, {
    x: valueX,
    yTop: topFromBaseline(options.y, size),
    width: options.fonts.bold.widthOfTextAtSize(options.value, size),
    height: size * 1.25,
  });

  return options.y - size * 2.1;
}

/** Institutional header: coat-of-arms placeholder, institution name, subtitle. */
export function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  options: { republic: string; institution: string; unit: string; y?: number },
): number {
  const top = options.y ?? PAGE_HEIGHT - MARGIN;

  // Placeholder for the national coat of arms. Explicitly a neutral geometric
  // mark: reproducing real state insignia on synthetic documents would make them
  // look like forgeries rather than fixtures.
  const emblemX = PAGE_WIDTH / 2;
  const emblemY = top - 18;
  page.drawCircle({ x: emblemX, y: emblemY, size: 20, borderColor: RULE, borderWidth: 1.2 });
  page.drawCircle({ x: emblemX, y: emblemY, size: 13, borderColor: RULE, borderWidth: 0.8 });
  page.drawText("SYNTH", {
    x: emblemX - fonts.bold.widthOfTextAtSize("SYNTH", 6) / 2,
    y: emblemY - 2,
    size: 6,
    font: fonts.bold,
    color: MUTED,
  });

  let cursor = top - 58;

  const centred = (text: string, font: PDFFont, size: number, color = INK) => {
    page.drawText(text, {
      x: (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2,
      y: cursor,
      size,
      font,
      color,
    });
    cursor -= size * 1.6;
  };

  centred(options.republic, fonts.serif, 9.5, MUTED);
  centred(options.institution, fonts.serifBold, 14);
  centred(options.unit, fonts.serif, 10, MUTED);

  cursor -= 6;
  page.drawLine({
    start: { x: MARGIN, y: cursor },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor },
    thickness: 0.8,
    color: RULE,
  });

  return cursor - 34;
}

/** Centred document title. */
export function drawTitle(page: PDFPage, fonts: Fonts, title: string, y: number): number {
  const size = 12.5;
  page.drawText(title, {
    x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(title, size)) / 2,
    y,
    size,
    font: fonts.bold,
    color: INK,
  });
  return y - size * 2.6;
}

/** Signature line with a stamp placeholder beside it. */
export function drawSignatureBlock(
  page: PDFPage,
  fonts: Fonts,
  options: { name: string; role: string; y: number },
): number {
  const lineWidth = 210;
  const x = MARGIN;

  page.drawLine({
    start: { x, y: options.y },
    end: { x: x + lineWidth, y: options.y },
    thickness: 0.8,
    color: RULE,
  });

  page.drawText(options.name, {
    x,
    y: options.y - 14,
    size: 10,
    font: fonts.bold,
    color: INK,
  });
  page.drawText(options.role, {
    x,
    y: options.y - 27,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  });

  // Round stamp placeholder, offset and rotated the way a real one lands.
  const stampX = PAGE_WIDTH - MARGIN - 60;
  const stampY = options.y + 6;
  page.drawCircle({ x: stampX, y: stampY, size: 42, borderColor: RULE, borderWidth: 1.4 });
  page.drawCircle({ x: stampX, y: stampY, size: 34, borderColor: RULE, borderWidth: 0.6 });
  page.drawText("DOCUMENTO", {
    x: stampX - fonts.bold.widthOfTextAtSize("DOCUMENTO", 7) / 2,
    y: stampY + 4,
    size: 7,
    font: fonts.bold,
    color: RULE,
  });
  page.drawText("SINTETICO", {
    x: stampX - fonts.bold.widthOfTextAtSize("SINTETICO", 7) / 2,
    y: stampY - 8,
    size: 7,
    font: fonts.bold,
    color: RULE,
  });

  return options.y - 48;
}

/**
 * Footer carrying the synthetic-data notice.
 *
 * Present on every generated page and not configurable: any file that leaves
 * this generator must be self-evidently a fixture, even when it is opened
 * outside the project with no other context.
 */
export function drawFooter(page: PDFPage, fonts: Fonts, reference: string): void {
  const notice =
    "DOCUMENTO SINTETICO GENERADO PARA PRUEBAS - SIN VALIDEZ LEGAL - NO EMITIDO POR NINGUNA INSTITUCION";
  const size = 6.8;

  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 26 },
    end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 26 },
    thickness: 0.5,
    color: RULE,
  });

  page.drawText(notice, {
    x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(notice, size)) / 2,
    y: MARGIN + 14,
    size,
    font: fonts.bold,
    color: MUTED,
  });

  page.drawText(reference, {
    x: (PAGE_WIDTH - fonts.regular.widthOfTextAtSize(reference, size)) / 2,
    y: MARGIN + 4,
    size,
    font: fonts.regular,
    color: MUTED,
  });
}

export { PDFDocument, rgb };
