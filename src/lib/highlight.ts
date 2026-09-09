/**
 * Geometry for the evidence highlight.
 *
 * Extracted from the route handler so it can be tested without a database or a
 * running server. Coordinate flips are the kind of bug that looks fine until
 * someone opens a document and finds the box over the wrong line, and by then
 * the only evidence is a screenshot.
 */

import type { BBox } from "@/lib/domain/types";

/** Breathing room around the text, as a fraction of the box's own size. */
export const HIGHLIGHT_PADDING = 0.35;

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a stored bbox to a PDF-space rectangle.
 *
 * Stored boxes are normalized with the origin at the top-left, matching every
 * other `BBox` in the project. PDF user space puts the origin at the bottom-left
 * and measures in points, so both the scale and the y axis change here.
 */
export function highlightRect(
  bbox: BBox,
  pageWidth: number,
  pageHeight: number,
  padding = HIGHLIGHT_PADDING,
): HighlightRect {
  const padX = bbox.width * pageWidth * padding;
  const padY = bbox.height * pageHeight * padding;

  return {
    x: bbox.x * pageWidth - padX,
    y: pageHeight - (bbox.y + bbox.height) * pageHeight - padY,
    width: bbox.width * pageWidth + padX * 2,
    height: bbox.height * pageHeight + padY * 2,
  };
}
