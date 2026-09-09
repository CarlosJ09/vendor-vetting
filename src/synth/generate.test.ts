import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateCorpus } from "./generate";

/**
 * The corpus is deliberately not committed: `pnpm synth` is supposed to recreate
 * it byte for byte from a seed, which is the only reason it is safe to gitignore
 * an eval set. This test is that claim, enforced.
 *
 * It has caught three separate violations already — unseeded libvips noise,
 * render randomness keyed to array position, and pdf-lib stamping the wall clock
 * into every PDF's CreationDate.
 */

async function hashTree(root: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, full);

    // The corpus index records a generation timestamp, which is expected to
    // differ between runs and says nothing about document content.
    if (relative === "index.json") continue;

    hashes.set(relative, createHash("sha256").update(await readFile(full)).digest("hex"));
  }

  return hashes;
}

describe("generateCorpus reproducibility", () => {
  let first: string;
  let second: string;

  beforeEach(async () => {
    first = await mkdtemp(path.join(tmpdir(), "vetting-corpus-a-"));
    second = await mkdtemp(path.join(tmpdir(), "vetting-corpus-b-"));
  });

  afterEach(async () => {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  });

  it("produces byte-identical output for the same seed", async () => {
    const options = { count: 3, defectiveRatio: 1, seed: 4242, clean: true };

    await generateCorpus({ ...options, outDir: first });
    await generateCorpus({ ...options, outDir: second });

    const a = await hashTree(first);
    const b = await hashTree(second);

    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [file, hash] of a) {
      expect({ file, hash }).toEqual({ file, hash: b.get(file) });
    }
  }, 120_000);

  it("produces different output for a different seed", async () => {
    await generateCorpus({ count: 2, defectiveRatio: 0, seed: 1, clean: true, outDir: first });
    await generateCorpus({ count: 2, defectiveRatio: 0, seed: 2, clean: true, outDir: second });

    const a = await hashTree(first);
    const b = await hashTree(second);

    expect([...a.values()].sort()).not.toEqual([...b.values()].sort());
  }, 120_000);

  it("renders a duplicated document to identical bytes", async () => {
    // The `duplicate_document` defect means the same file attached twice, so the
    // two copies must be indistinguishable by content hash.
    await generateCorpus({
      count: 12,
      defectiveRatio: 1,
      seed: 99,
      clean: true,
      outDir: first,
    });

    let checked = 0;

    for (const dir of (await readdir(first)).filter((d) => d.startsWith("dossier-"))) {
      const groundTruth = JSON.parse(
        await readFile(path.join(first, dir, "ground-truth.json"), "utf8"),
      ) as { defects: { kind: string }[]; documents: { filename: string; type: string }[] };

      if (!groundTruth.defects.some((d) => d.kind === "duplicate_document")) continue;

      const byType = new Map<string, string[]>();
      for (const document of groundTruth.documents) {
        byType.set(document.type, [...(byType.get(document.type) ?? []), document.filename]);
      }

      for (const [, filenames] of byType) {
        if (filenames.length < 2) continue;
        const hashes = await Promise.all(
          filenames.map(async (name) =>
            createHash("sha256")
              .update(await readFile(path.join(first, dir, name)))
              .digest("hex"),
          ),
        );
        expect(new Set(hashes).size).toBe(1);
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(0);
  }, 180_000);
});
