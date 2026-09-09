import Link from "next/link";

import { isReachable } from "@/db/client";
import { listDossiers } from "@/db/persist";

import { StatusBadge } from "./_components/status";

// Every read hits Postgres, and the pipeline writes to it outside the request
// cycle, so a cached render would show a stale verdict.
export const dynamic = "force-dynamic";

function EmptyState({ reason }: { reason: "no-db" | "no-dossiers" }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8">
      <h2 className="text-base font-medium">
        {reason === "no-db" ? "No hay conexión con la base de datos" : "Todavía no hay dossiers"}
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {reason === "no-db"
          ? "Levanta Postgres y aplica las migraciones:"
          : "Genera el corpus sintético y procésalo:"}
      </p>
      <pre className="mt-4 overflow-x-auto rounded bg-[var(--background)] p-4 font-mono text-xs">
        {reason === "no-db"
          ? "pnpm db:up\npnpm db:migrate"
          : "pnpm synth\npnpm ingest --corpus data/synthetic"}
      </pre>
    </div>
  );
}

export default async function DossiersPage() {
  if (!(await isReachable())) return <EmptyState reason="no-db" />;

  const dossiers = await listDossiers();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Dossiers</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {dossiers.length} procesado{dossiers.length === 1 ? "" : "s"}. El veredicto lo produce
          código determinista a partir de lo que el modelo transcribió.
        </p>
      </div>

      {dossiers.length === 0 ? (
        <EmptyState reason="no-dossiers" />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {dossiers.map((dossier) => (
            <li key={dossier.id}>
              <Link
                href={`/dossiers/${encodeURIComponent(dossier.externalId)}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--surface)]"
              >
                <span className="font-mono text-sm">{dossier.externalId}</span>

                <span className="ml-auto text-xs text-[var(--muted)]">
                  {dossier.documentCount} doc{dossier.documentCount === 1 ? "" : "s"}
                </span>

                {dossier.needsReviewCount > 0 && (
                  <span className="text-xs" style={{ color: "var(--review)" }}>
                    {dossier.needsReviewCount} para revisión
                  </span>
                )}

                <span className="text-xs text-[var(--muted)] tabular-nums">
                  al {dossier.referenceDate}
                </span>

                {dossier.overallStatus && <StatusBadge status={dossier.overallStatus} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
