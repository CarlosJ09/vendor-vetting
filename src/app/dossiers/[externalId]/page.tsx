import Link from "next/link";
import { notFound } from "next/navigation";

import { isReachable } from "@/db/client";
import { loadDossier } from "@/db/persist";
import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/types";
import type { RequirementStatus } from "@/lib/domain/types";
import { REQUIREMENTS } from "@/lib/validation/types";
import type { RequirementKey } from "@/lib/validation/types";

import { StatusBadge, StatusStripe } from "../../_components/status";

export const dynamic = "force-dynamic";

/** Failures first: the reason someone opened this page is at the top. */
const STATUS_ORDER: Record<RequirementStatus, number> = {
  fail: 0,
  needs_review: 1,
  warn: 2,
  pass: 3,
};

function labelFor(requirement: string): string {
  return REQUIREMENTS[requirement as RequirementKey] ?? requirement;
}

export default async function DossierPage({ params }: PageProps<"/dossiers/[externalId]">) {
  const { externalId } = await params;

  if (!(await isReachable())) notFound();

  const loaded = await loadDossier(decodeURIComponent(externalId));
  if (loaded === null) notFound();

  const { dossier, documents, requirements } = loaded;

  const documentsById = new Map(documents.map((entry) => [entry.document.id, entry]));

  const sorted = [...requirements].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.requirement.localeCompare(b.requirement),
  );

  const reviewFields = documents.flatMap((entry) =>
    entry.fields
      .filter((field) => field.needsReview)
      .map((field) => ({ field, filename: entry.document.filename, documentId: entry.document.id })),
  );

  return (
    <>
      <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        ← Dossiers
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold tracking-tight">{dossier.externalId}</h1>
        {dossier.overallStatus && <StatusBadge status={dossier.overallStatus} />}
        <span className="text-sm text-[var(--muted)]">
          evaluado al {dossier.referenceDate}
        </span>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Cada veredicto lo produce código determinista. El modelo sólo transcribió lo que el
        documento dice; no se le preguntó si algo estaba vigente, era válido o coincidía.
      </p>

      {/* ----------------------------------------------------- requisitos -- */}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Requisitos
      </h2>

      <ul className="mt-3 space-y-2">
        {sorted.map((requirement) => (
          <li
            key={requirement.id}
            className="relative overflow-hidden rounded-lg border border-[var(--border)] py-3 pl-5 pr-4"
          >
            <StatusStripe status={requirement.status} />

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{labelFor(requirement.requirement)}</span>
              <StatusBadge status={requirement.status} />
            </div>

            <p className="mt-1 text-sm text-[var(--muted)]">{requirement.detail}</p>

            {requirement.evidence && requirement.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {requirement.evidence.map((item, index) => {
                  const entry = documentsById.get(item.documentId);
                  if (entry === undefined) return null;

                  const value = entry.fields.find((field) => field.field === item.field);

                  return (
                    <Link
                      key={`${item.documentId}-${item.field}-${index}`}
                      href={`/dossiers/${encodeURIComponent(dossier.externalId)}/documento/${item.documentId}?campo=${encodeURIComponent(item.field)}`}
                      className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs hover:border-[var(--muted)]"
                    >
                      <span className="text-[var(--muted)]">{entry.document.filename}</span>
                      <span className="mx-1.5 text-[var(--muted)]">·</span>
                      <span className="font-mono">{item.field}</span>
                      {value?.normalizedValue ? (
                        <>
                          <span className="mx-1.5 text-[var(--muted)]">=</span>
                          <span className="font-mono">{value.normalizedValue}</span>
                        </>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------------ revisión -- */}

      {reviewFields.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Pendiente de revisión humana
          </h2>
          <ul className="mt-3 space-y-2">
            {reviewFields.map(({ field, filename, documentId }) => (
              <li
                key={field.id}
                className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm"
              >
                <Link
                  href={`/dossiers/${encodeURIComponent(dossier.externalId)}/documento/${documentId}?campo=${encodeURIComponent(field.field)}`}
                  className="font-mono hover:underline"
                >
                  {field.field}
                </Link>
                <span className="ml-2 text-[var(--muted)]">en {filename}</span>
                <span className="ml-2 tabular-nums" style={{ color: "var(--review)" }}>
                  confianza {field.confidence.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ----------------------------------------------------- documentos -- */}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Documentos
      </h2>

      <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {documents.map(({ document, fields }) => (
          <li key={document.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-3">
            <Link
              href={`/dossiers/${encodeURIComponent(dossier.externalId)}/documento/${document.id}`}
              className="text-sm hover:underline"
            >
              {document.filename}
            </Link>
            <span className="text-xs text-[var(--muted)]">
              {document.classifiedType
                ? (DOCUMENT_TYPE_LABELS[
                    document.classifiedType as keyof typeof DOCUMENT_TYPE_LABELS
                  ] ?? "No reconocido")
                : "No reconocido"}
            </span>
            <span className="ml-auto text-xs text-[var(--muted)] tabular-nums">
              {fields.length} campo{fields.length === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
