/**
 * Serves the bytes of a stored document.
 *
 * The path on disk is never accepted from the request — only the document's
 * UUID is, and everything else is read from the row it names. A route that took
 * a path would be a directory traversal waiting to happen, and this one is
 * reachable by anyone who can reach the app (§2: no auth beyond a stub).
 *
 * Bytes come from the database when they are there, and from the filesystem
 * otherwise. The fallback is what keeps local development working against rows
 * written before documents were stored inline; a deployment has no filesystem
 * to fall back to, which is exactly why the column exists.
 */

import { loadDocumentContent } from "@/db/persist";
import { documentBytes } from "@/lib/documents";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  // A malformed id would otherwise reach Postgres and raise a type error.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const document = await loadDocumentContent(id);
  if (document === null) return new Response("Not found", { status: 404 });

  const bytes = await documentBytes(document);
  if (bytes === null) {
    // The row outlived the file: a corpus regenerated under the same dossier,
    // on a row that predates inline storage.
    return new Response("El archivo ya no está disponible", { status: 410 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": document.mimeType,
      // Never as an attachment: the viewer embeds these inline.
      "Content-Disposition": "inline",
      // Documents are immutable once ingested, and the id changes when the
      // dossier is re-processed.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
