/**
 * Stage 1 — ingest.
 *
 * Accepts a folder of files and makes no assumptions about their names (§7).
 * Filenames in this domain are whatever the supplier's phone or scanner produced,
 * so nothing downstream may depend on them.
 *
 * Two decisions worth stating:
 *
 *  - **Type detection reads magic bytes, not extensions.** A PDF saved as
 *    `.jpg` is common enough in real intake, and dispatching `render` on the
 *    extension would send it down the wrong path with a confusing failure.
 *  - **Content is hashed here.** Duplicate detection is then exact and
 *    deterministic, decided by SHA-256 rather than by asking a model whether two
 *    documents look alike.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** File kinds the pipeline knows how to render. */
export type IngestedKind = "pdf" | "image";

export interface IngestedFile {
  /** Absolute path on disk. */
  storagePath: string;
  /** Original filename, preserved for display only. */
  filename: string;
  kind: IngestedKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface SkippedFile {
  filename: string;
  reason: "unsupported_type" | "empty_file";
  detail: string;
}

export interface IngestResult {
  files: IngestedFile[];
  skipped: SkippedFile[];
  /** Groups of files with identical content, keyed by hash. */
  duplicateGroups: { sha256: string; filenames: string[] }[];
}

/**
 * Magic-byte signatures, checked in order.
 *
 * JPEG and PNG cover what a phone camera or scanner produces; PDF covers the
 * certifications. Anything else is skipped loudly rather than guessed at.
 */
const SIGNATURES: {
  mimeType: string;
  kind: IngestedKind;
  matches: (bytes: Buffer) => boolean;
}[] = [
  {
    mimeType: "application/pdf",
    kind: "pdf",
    // %PDF-
    matches: (b) => b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-",
  },
  {
    mimeType: "image/jpeg",
    kind: "image",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: "image/png",
    kind: "image",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mimeType: "image/webp",
    kind: "image",
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/** Identify a file from its leading bytes, ignoring its extension entirely. */
export function detectType(bytes: Buffer): { mimeType: string; kind: IngestedKind } | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) {
      return { mimeType: signature.mimeType, kind: signature.kind };
    }
  }
  return null;
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read a folder of supplier documents.
 *
 * Non-recursive and non-hidden by default: an intake folder is flat, and
 * descending into arbitrary subdirectories would pick up whatever else happens
 * to be lying around. Ground-truth files from the synthetic corpus are excluded
 * by name so a generated dossier directory can be ingested as-is.
 */
export async function ingestFolder(folderPath: string): Promise<IngestResult> {
  const entries = await readdir(folderPath, { withFileTypes: true });

  const files: IngestedFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "ground-truth.json" || entry.name === "index.json") continue;

    const fullPath = path.join(folderPath, entry.name);
    const info = await stat(fullPath);

    if (info.size === 0) {
      skipped.push({ filename: entry.name, reason: "empty_file", detail: "File is 0 bytes" });
      continue;
    }

    const bytes = await readFile(fullPath);
    const detected = detectType(bytes);

    if (!detected) {
      skipped.push({
        filename: entry.name,
        reason: "unsupported_type",
        detail: "Leading bytes match no supported PDF or image signature",
      });
      continue;
    }

    files.push({
      storagePath: fullPath,
      filename: entry.name,
      kind: detected.kind,
      mimeType: detected.mimeType,
      byteSize: info.size,
      sha256: sha256(bytes),
    });
  }

  const byHash = new Map<string, string[]>();
  for (const file of files) {
    byHash.set(file.sha256, [...(byHash.get(file.sha256) ?? []), file.filename]);
  }

  const duplicateGroups = [...byHash.entries()]
    .filter(([, filenames]) => filenames.length > 1)
    .map(([hash, filenames]) => ({ sha256: hash, filenames }));

  return { files, skipped, duplicateGroups };
}
