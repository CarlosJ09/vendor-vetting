import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { documentBytes } from "./documents";

describe("documentBytes", () => {
  it("prefers stored content over the filesystem", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vetting-"));
    const file = path.join(dir, "doc.pdf");
    await writeFile(file, "from disk");

    const bytes = await documentBytes({
      storagePath: file,
      content: Buffer.from("from database"),
    });

    // A deployment has no filesystem, so the database must win wherever both
    // exist — otherwise local and deployed serve different bytes.
    expect(bytes!.toString()).toBe("from database");
  });

  it("falls back to disk when nothing is stored", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vetting-"));
    const file = path.join(dir, "doc.pdf");
    await writeFile(file, "from disk");

    const bytes = await documentBytes({ storagePath: file, content: null });

    expect(bytes!.toString()).toBe("from disk");
  });

  it("returns null when neither source has the file", async () => {
    const bytes = await documentBytes({
      storagePath: "/nonexistent/definitely-not-here.pdf",
      content: null,
    });

    expect(bytes).toBeNull();
  });

  it("does not corrupt binary content", async () => {
    const raw = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const bytes = await documentBytes({ storagePath: "/nope", content: raw });

    expect(bytes!.equals(raw)).toBe(true);
  });
});
