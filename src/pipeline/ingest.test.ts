import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectType, ingestFolder, sha256 } from "./ingest";

const PDF_HEADER = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1");
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
]);

describe("detectType", () => {
  it("recognises a PDF", () => {
    expect(detectType(PDF_HEADER)).toEqual({ mimeType: "application/pdf", kind: "pdf" });
  });

  it("recognises JPEG, PNG and WebP as images", () => {
    expect(detectType(JPEG_HEADER)?.kind).toBe("image");
    expect(detectType(PNG_HEADER)?.kind).toBe("image");
    expect(detectType(WEBP_HEADER)?.kind).toBe("image");
  });

  it("returns null for content it does not recognise", () => {
    expect(detectType(Buffer.from("just some text"))).toBeNull();
    expect(detectType(Buffer.alloc(0))).toBeNull();
  });

  it("does not mistake a truncated signature for a match", () => {
    expect(detectType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectType(Buffer.from("%PD", "latin1"))).toBeNull();
  });
});

describe("ingestFolder", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), "vetting-ingest-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const write = (name: string, bytes: Buffer) => writeFile(path.join(folder, name), bytes);

  it("ingests a flat folder of mixed documents", async () => {
    await write("archivo (3).pdf", PDF_HEADER);
    await write("IMG_0042.jpg", JPEG_HEADER);

    const result = await ingestFolder(folder);

    expect(result.files).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    expect(result.files.map((f) => f.kind).sort()).toEqual(["image", "pdf"]);
  });

  it("classifies by content, not by extension", async () => {
    // A PDF that someone saved with a .jpg name. Dispatching render on the
    // extension would send this down the image path and fail confusingly.
    await write("escaneo.jpg", PDF_HEADER);

    const result = await ingestFolder(folder);

    expect(result.files[0].kind).toBe("pdf");
    expect(result.files[0].mimeType).toBe("application/pdf");
    expect(result.files[0].filename).toBe("escaneo.jpg");
  });

  it("skips unsupported content instead of guessing", async () => {
    await write("notas.txt", Buffer.from("no es un documento"));

    const result = await ingestFolder(folder);

    expect(result.files).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("unsupported_type");
  });

  it("skips empty files", async () => {
    await write("vacio.pdf", Buffer.alloc(0));

    const result = await ingestFolder(folder);

    expect(result.skipped[0].reason).toBe("empty_file");
  });

  it("ignores hidden files and corpus metadata", async () => {
    await write("documento.pdf", PDF_HEADER);
    await write(".DS_Store", Buffer.from("junk"));
    await write("ground-truth.json", Buffer.from("{}"));
    await write("index.json", Buffer.from("{}"));

    const result = await ingestFolder(folder);

    expect(result.files).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it("detects duplicates by content hash, not by filename", async () => {
    const body = Buffer.concat([PDF_HEADER, Buffer.from("mismo contenido")]);
    await write("original.pdf", body);
    await write("copia (1).pdf", body);
    await write("otro.pdf", Buffer.concat([PDF_HEADER, Buffer.from("distinto")]));

    const result = await ingestFolder(folder);

    expect(result.files).toHaveLength(3);
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].filenames.sort()).toEqual(["copia (1).pdf", "original.pdf"]);
  });

  it("reports no duplicates when contents differ", async () => {
    await write("a.pdf", Buffer.concat([PDF_HEADER, Buffer.from("a")]));
    await write("b.pdf", Buffer.concat([PDF_HEADER, Buffer.from("b")]));

    expect((await ingestFolder(folder)).duplicateGroups).toEqual([]);
  });

  it("returns files in a stable order across runs", async () => {
    await write("zeta.pdf", PDF_HEADER);
    await write("alfa.pdf", PDF_HEADER);
    await write("media.pdf", PDF_HEADER);

    const first = (await ingestFolder(folder)).files.map((f) => f.filename);
    const second = (await ingestFolder(folder)).files.map((f) => f.filename);

    expect(first).toEqual(second);
    expect(first).toEqual(["alfa.pdf", "media.pdf", "zeta.pdf"]);
  });

  it("records size and hash for each file", async () => {
    const body = Buffer.concat([PDF_HEADER, Buffer.from("contenido")]);
    await write("doc.pdf", body);

    const [file] = (await ingestFolder(folder)).files;

    expect(file.byteSize).toBe(body.length);
    expect(file.sha256).toBe(sha256(body));
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
