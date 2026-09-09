/**
 * Reading a stored document's bytes.
 *
 * Shared by the two routes that serve documents so the fallback rule is stated
 * once. A second copy of "database first, then disk" would eventually disagree
 * with the first.
 */

import { readFile } from "node:fs/promises";

export interface StoredDocument {
  storagePath: string;
  content: Buffer | null;
}

/** Bytes from the database if stored, else from disk, else `null`. */
export async function documentBytes(document: StoredDocument): Promise<Buffer | null> {
  if (document.content !== null) return Buffer.from(document.content);
  return readFile(document.storagePath).catch(() => null);
}
