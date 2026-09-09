import Link from "next/link";

import { isReachable } from "@/db/client";
import { listReviewQueue } from "@/db/persist";
import { CONFIDENCE_THRESHOLD } from "@/lib/config";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  if (!(await isReachable())) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No hay conexión con la base de datos. Ejecuta <code>pnpm db:up</code>.
      </p>
    );
  }

  const queue = await listReviewQueue();

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Cola de revisión</h1>

      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Campos cuya confianza quedó por debajo de {CONFIDENCE_THRESHOLD.toFixed(2)}. No se rechazan
        automáticamente: el requisito que depende de ellos queda en{" "}
        <em>requiere revisión</em> hasta que una persona lo confirme. Una extracción en la que el
        sistema no confía no puede probar que un documento esté bien{" "}
        <strong>ni que esté mal</strong>.
      </p>

      {queue.length === 0 ? (
        <p className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          Nada pendiente de revisión.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {queue.map((entry) => (
            <li key={`${entry.documentId}-${entry.field}`}>
              <Link
                href={`/dossiers/${encodeURIComponent(entry.externalId)}/documento/${entry.documentId}?campo=${encodeURIComponent(entry.field)}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-[var(--surface)]"
              >
                <span
                  className="tabular-nums font-medium"
                  style={{ color: "var(--review)" }}
                  title="Confianza reportada por el modelo"
                >
                  {entry.confidence.toFixed(2)}
                </span>
                <span className="font-mono">{entry.field}</span>
                <span className="font-mono text-[var(--muted)]">{entry.rawValue || "—"}</span>
                <span className="ml-auto font-mono text-xs text-[var(--muted)]">
                  {entry.externalId}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {entry.classifiedType
                    ? (DOCUMENT_TYPE_LABELS[
                        entry.classifiedType as keyof typeof DOCUMENT_TYPE_LABELS
                      ] ?? entry.filename)
                    : entry.filename}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
