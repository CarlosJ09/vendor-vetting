import type { RequirementStatus } from "@/lib/domain/types";

export const STATUS_LABELS: Record<RequirementStatus, string> = {
  pass: "Cumple",
  warn: "Advertencia",
  fail: "No cumple",
  needs_review: "Requiere revisión",
};

const STATUS_VARS: Record<RequirementStatus, { fg: string; bg: string }> = {
  pass: { fg: "var(--pass)", bg: "var(--pass-bg)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-bg)" },
  fail: { fg: "var(--fail)", bg: "var(--fail-bg)" },
  needs_review: { fg: "var(--review)", bg: "var(--review-bg)" },
};

/**
 * Status is never carried by colour alone.
 *
 * Roughly one in twelve men has a red/green colour vision deficiency, and this
 * badge distinguishes "cumple" from "no cumple" — the one distinction on the
 * screen that has to survive that. Hence the always-present text label.
 */
export function StatusBadge({
  status,
  className = "",
}: {
  status: RequirementStatus;
  className?: string;
}) {
  const { fg, bg } = STATUS_VARS[status];

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      style={{ color: fg, backgroundColor: bg }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** A thin coloured rule, used to key a row to its status without repeating it. */
export function StatusStripe({ status }: { status: RequirementStatus }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-1 rounded-l"
      style={{ backgroundColor: STATUS_VARS[status].fg }}
    />
  );
}
