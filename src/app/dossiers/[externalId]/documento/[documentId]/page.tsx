import Link from "next/link";
import { notFound } from "next/navigation";

import { isReachable } from "@/db/client";
import { loadDossier } from "@/db/persist";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/types";
import type { BBox } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/**
 * Draws the located region over a scanned image.
 *
 * Only reachable in principle: the locator searches a PDF text layer, and a
 * scan has none, so images currently arrive with no box. Kept because the
 * moment OCR geometry exists this is where it renders, and because a viewer
 * that silently ignored a stored box would hide the gap instead of showing it.
 */
function ImageWithRegion({ src, bbox, alt }: { src: string; bbox: BBox | null; alt: string }) {
  return (
    <div className="relative inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- served from a
          route handler at unknown intrinsic size; next/image buys nothing. */}
      <img src={src} alt={alt} className="max-w-full rounded border border-[var(--border)]" />
      {bbox && (
        <span
          aria-hidden
          className="absolute rounded-sm"
          style={{
            left: `${bbox.x * 100}%`,
            top: `${bbox.y * 100}%`,
            width: `${bbox.width * 100}%`,
            height: `${bbox.height * 100}%`,
            backgroundColor: "rgba(255, 217, 51, 0.35)",
            outline: "1px solid rgba(217, 128, 0, 0.9)",
          }}
        />
      )}
    </div>
  );
}

export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/dossiers/[externalId]/documento/[documentId]">) {
  const { externalId, documentId } = await params;
  const { campo } = await searchParams;
  const field = typeof campo === "string" ? campo : undefined;

  if (!(await isReachable())) notFound();

  const loaded = await loadDossier(decodeURIComponent(externalId));
  if (loaded === null) notFound();

  const entry = loaded.documents.find((item) => item.document.id === documentId);
  if (entry === undefined) notFound();

  const { document, fields } = entry;
  const selected = field === undefined ? undefined : fields.find((f) => f.field === field);
  const isPdf = document.mimeType === "application/pdf";

  const src =
    selected !== undefined && isPdf
      ? `/api/documentos/${document.id}/resaltado?campo=${encodeURIComponent(selected.field)}`
      : `/api/documentos/${document.id}`;

  const page = selected?.page ?? 1;

  return (
    <>
      <Link
        href={`/dossiers/${encodeURIComponent(externalId)}`}
        className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        ← {decodeURIComponent(externalId)}
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{document.filename}</h1>
        <span className="text-sm text-[var(--muted)]">
          {document.classifiedType
            ? (DOCUMENT_TYPE_LABELS[
                document.classifiedType as keyof typeof DOCUMENT_TYPE_LABELS
              ] ?? "No reconocido")
            : "No reconocido"}
        </span>
      </div>

      {selected && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          <span className="font-mono">{selected.field}</span>
          <span className="mx-2 text-[var(--muted)]">=</span>
          <span className="font-mono">{selected.normalizedValue}</span>
          {selected.rawValue && selected.rawValue !== selected.normalizedValue && (
            <span className="ml-2 text-xs text-[var(--muted)]">
              (transcrito: <span className="font-mono">{selected.rawValue}</span>)
            </span>
          )}
          <span className="ml-3 text-xs text-[var(--muted)]">
            página {page} · confianza {selected.confidence.toFixed(2)}
          </span>
          {selected.bbox === null && (
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {isPdf
                ? "El valor no se encontró literalmente en la capa de texto, así que no se resalta ninguna región. El campo «estado» es normalmente así: es una clasificación de la prosa, no una cadena impresa."
                : "Documento escaneado: no hay capa de texto donde localizar la región, así que no se resalta ninguna. Recuperarla necesitaría geometría OCR por palabra."}
            </span>
          )}
        </p>
      )}

      <div className="mt-4">
        {isPdf ? (
          <iframe
            // The page fragment is what makes a multi-page document land on the
            // right page; the highlight is already drawn into the bytes.
            src={`${src}#page=${page}`}
            title={document.filename}
            className="h-[80vh] w-full rounded border border-[var(--border)]"
          />
        ) : (
          <ImageWithRegion
            src={src}
            bbox={selected?.bbox ?? null}
            alt={`Documento ${document.filename}`}
          />
        )}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Campos extraídos
      </h2>

      <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {fields.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm">
            <Link
              href={`?campo=${encodeURIComponent(item.field)}`}
              className={`font-mono hover:underline ${item.field === field ? "font-semibold" : ""}`}
            >
              {item.field}
            </Link>
            <span className="font-mono text-[var(--muted)]">{item.normalizedValue}</span>
            <span className="ml-auto text-xs tabular-nums text-[var(--muted)]">
              {item.bbox === null ? "sin región" : `pág. ${item.page}`} · {item.confidence.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
