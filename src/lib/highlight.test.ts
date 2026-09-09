import { describe, expect, it } from "vitest";

import { highlightRect } from "./highlight";

const A4 = { width: 595.28, height: 841.89 };

describe("highlightRect", () => {
  it("flips the y axis from top-left to bottom-left origin", () => {
    // A box at the very top of the page must land at the top in PDF space,
    // which is a high y — not a low one.
    const top = highlightRect({ x: 0, y: 0, width: 0.1, height: 0.02 }, A4.width, A4.height, 0);
    const bottom = highlightRect({ x: 0, y: 0.98, width: 0.1, height: 0.02 }, A4.width, A4.height, 0);

    expect(top.y).toBeGreaterThan(bottom.y);
    expect(top.y + top.height).toBeCloseTo(A4.height, 5);
    expect(bottom.y).toBeCloseTo(0, 5);
  });

  it("scales normalized coordinates to points", () => {
    const rect = highlightRect({ x: 0.5, y: 0.5, width: 0.25, height: 0.1 }, A4.width, A4.height, 0);

    expect(rect.x).toBeCloseTo(A4.width / 2, 5);
    expect(rect.width).toBeCloseTo(A4.width * 0.25, 5);
    expect(rect.height).toBeCloseTo(A4.height * 0.1, 5);
  });

  it("pads symmetrically around the value", () => {
    const bare = highlightRect({ x: 0.4, y: 0.4, width: 0.1, height: 0.02 }, A4.width, A4.height, 0);
    const padded = highlightRect(
      { x: 0.4, y: 0.4, width: 0.1, height: 0.02 },
      A4.width,
      A4.height,
      0.5,
    );

    // The centre must not move when padding grows.
    expect(padded.x + padded.width / 2).toBeCloseTo(bare.x + bare.width / 2, 5);
    expect(padded.y + padded.height / 2).toBeCloseTo(bare.y + bare.height / 2, 5);
    expect(padded.width).toBeCloseTo(bare.width * 2, 5);
  });

  it("reproduces the geometry pdf-lib emitted for a located RNC", () => {
    /*
     * Pinned from an actual highlighted PDF, read back out of its content
     * stream. This is the number that a coordinate-flip regression would
     * change, and the only one a reader can check against the real document.
     */
    const bbox = {
      x: 0.3846929176185997,
      y: 0.3888275190345531,
      width: 0.09246741029431528,
      height: 0.013065839955338584,
    };

    const rect = highlightRect(bbox, 595.28, 841.89);

    expect(rect.x).toBeCloseTo(209.73, 2);
    expect(rect.y).toBeCloseTo(499.69, 2);
    expect(rect.width).toBeCloseTo(93.57, 2);
    expect(rect.height).toBeCloseTo(18.7, 2);
  });
});
