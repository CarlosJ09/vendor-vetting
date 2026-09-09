/**
 * Serves a PDF with one field's region highlighted.
 *
 * The browser's built-in PDF viewer can jump to a page but cannot draw on one,
 * and rasterising pages to overlay a box in HTML would mean a new native
 * dependency. Drawing the rectangle into a copy of the PDF instead uses
 * `pdf-lib`, which is already here for the synthetic generator, and keeps the
 * coordinates exact rather than resampled.
 *
 * The original file on disk is never modified: the highlight is drawn on bytes
 * read into memory and discarded after the response.
 */

import { and, eq } from "drizzle-orm";
import { PDFDocument, rgb } from "pdf-lib";

import { db } from "@/db/client";
import { documents, extractedFields } from "@/db/schema";
import type { BBox } from "@/lib/domain/types";
import { documentBytes } from "@/lib/documents";
import { highlightRect } from "@/lib/highlight";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const field = new URL(request.url).searchParams.get("campo");

  if (!/^[0-9a-f-]{36}$/i.test(id) || field === null) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await db()
    .select({
      storagePath: documents.storagePath,
      content: documents.content,
      mimeType: documents.mimeType,
      page: extractedFields.page,
      bbox: extractedFields.bbox,
    })
    .from(extractedFields)
    .innerJoin(documents, eq(extractedFields.documentId, documents.id))
    .where(and(eq(extractedFields.documentId, id), eq(extractedFields.field, field)))
    .limit(1);

  if (row === undefined) return new Response("Not found", { status: 404 });

  const bytes = await documentBytes(row);
  if (bytes === null) {
    return new Response("El archivo ya no está disponible", { status: 410 });
  }

  const bbox = row.bbox as BBox | null;

  // No region located, or not a PDF: hand back the file untouched rather than
  // guessing at a rectangle. The viewer says the region is unknown.
  if (bbox === null || row.mimeType !== "application/pdf") {
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": row.mimeType, "Content-Disposition": "inline" },
    });
  }

  const pdf = await PDFDocument.load(new Uint8Array(bytes));
  const page = pdf.getPage(Math.max(0, (row.page ?? 1) - 1));
  const { width, height } = page.getSize();

  page.drawRectangle({
    ...highlightRect(bbox, width, height),
    color: rgb(1, 0.85, 0.2),
    opacity: 0.35,
    borderColor: rgb(0.85, 0.5, 0),
    borderWidth: 1,
  });

  const output = await pdf.save();

  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      // Derived from immutable inputs, but cheap to regenerate; kept short so a
      // re-ingest is visible without a hard refresh.
      "Cache-Control": "private, max-age=60",
    },
  });
}
