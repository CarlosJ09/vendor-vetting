/**
 * Citation locator.
 *
 * Turns "the model says the RNC is 101850043" into "and here is where that
 * string sits on page 1", so the dossier can link a finding to the region of
 * the document that supports it (§7).
 *
 * ## Why this is code and not a model call
 *
 * Asking a vision model for a bounding box is asking it to judge geometry, and
 * it would produce a plausible rectangle whether or not the value is there.
 * Searching the text layer for a string either finds it or does not. When it
 * does not, this returns `null` and the UI says the region is unknown — which
 * is a true statement, unlike a confident wrong box.
 *
 * ## Limitation
 *
 * A scanned image has no text layer, so cedula fields get no region at all.
 * That is stated in the dossier rather than papered over; recovering it would
 * need per-word OCR geometry, which the current vision path does not produce.
 */

import type { BBox } from "@/lib/domain/types";

import type { RenderedPage, TextFragment } from "./render";

export interface Citation {
  page: number;
  bbox: BBox;
  /**
   * True when the box covers more than the value itself — because the value was
   * found inside a longer fragment, and narrowing it would require glyph widths
   * the text layer does not carry.
   */
  approximate: boolean;
}

/**
 * Fold a string to its comparison form: lowercase, unaccented, single-spaced.
 *
 * Punctuation is kept. `S.R.L.` and `SRL` are genuinely different strings on
 * the page, and the locator's job is to find what was printed, not to decide
 * that two spellings mean the same company — that judgement lives in
 * `lib/names.ts`, where it is tested.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Smallest box containing all of the given fragments. */
function union(fragments: TextFragment[]): BBox {
  const left = Math.min(...fragments.map((f) => f.bbox.x));
  const top = Math.min(...fragments.map((f) => f.bbox.y));
  const right = Math.max(...fragments.map((f) => f.bbox.x + f.bbox.width));
  const bottom = Math.max(...fragments.map((f) => f.bbox.y + f.bbox.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Fragments sharing a line, as `fragmentsToText` groups them. */
const LINE_TOLERANCE = 0.006;

function sameLine(a: TextFragment, b: TextFragment): boolean {
  return Math.abs(a.bbox.y - b.bbox.y) <= LINE_TOLERANCE;
}

export function locateValue(pages: RenderedPage[], value: string): Citation | null {
  const needle = fold(value);
  if (needle === "") return null;

  for (const page of pages) {
    const fragments = [...page.fragments].sort(
      (a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x,
    );

    // 1. An exact fragment. The common case, and the only one that yields a
    //    box tight around the value.
    const exact = fragments.find((fragment) => fold(fragment.text) === needle);
    if (exact) return { page: page.pageNumber, bbox: exact.bbox, approximate: false };

    // 2. A run of consecutive fragments on one line. Producers split styled
    //    runs, so a company name often arrives in pieces.
    for (let start = 0; start < fragments.length; start++) {
      let joined = fold(fragments[start].text);
      if (joined === "") continue;

      for (let end = start + 1; end < fragments.length; end++) {
        if (!sameLine(fragments[start], fragments[end])) break;

        joined = `${joined} ${fold(fragments[end].text)}`;
        if (joined === needle) {
          return {
            page: page.pageNumber,
            bbox: union(fragments.slice(start, end + 1)),
            approximate: false,
          };
        }
        // Once the run is longer than the needle it can only get longer.
        if (joined.length > needle.length) break;
      }
    }

    // 3. Inside a longer fragment. Answerable, but only to fragment precision.
    const containing = fragments.find((fragment) => fold(fragment.text).includes(needle));
    if (containing) {
      return { page: page.pageNumber, bbox: containing.bbox, approximate: true };
    }
  }

  return null;
}
