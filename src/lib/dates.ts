/**
 * Date handling for the vetting pipeline.
 *
 * Every date in this domain is a calendar date printed on a document — it has no
 * time and no timezone. Representing them as JS `Date` objects invites a whole
 * class of off-by-one bugs where a document issued on the 15th reads as the 14th
 * because the process runs in UTC-4. So the canonical representation is a
 * `PlainDate` string in `YYYY-MM-DD`, and all arithmetic is done in whole UTC
 * days. `Date` is used only as an internal calendar calculator, never stored.
 */

/** A calendar date with no time or timezone component, formatted `YYYY-MM-DD`. */
export type PlainDate = string;

const MS_PER_DAY = 86_400_000;

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `DD/MM/YYYY` with `/`, `-` or `.` separators, day and month optionally unpadded. */
const NUMERIC_DATE_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/** The Spanish long form printed on the certifications: `15 de marzo de 2024`. */
const LONG_FORM_RE = /^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/;

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9, // accepted variant
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Lowercase and strip diacritics so `MARZO` and `Márzo` both match `marzo`. */
function foldCase(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * True when the triple names a real calendar date. Guards against the rollover
 * that `Date.UTC` performs silently, where 31 February becomes 2 March.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function format(year: number, month: number, day: number): PlainDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a date as printed on a Dominican document, returning `null` when the
 * input is not an unambiguous, real date.
 *
 * Deliberately does NOT accept `YYYY-MM-DD` input: a document that appears to
 * carry an ISO date is more likely an extraction error than a genuine reading,
 * and silently accepting it would mask that. Callers holding a known-canonical
 * value should use `parsePlainDate`.
 */
export function parseDominicanDate(raw: string): PlainDate | null {
  const text = foldCase(raw);
  if (!text) return null;

  const numeric = NUMERIC_DATE_RE.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    return isRealDate(year, month, day) ? format(year, month, day) : null;
  }

  const long = LONG_FORM_RE.exec(text);
  if (long) {
    const day = Number(long[1]);
    const month = MONTHS_ES[long[2]];
    const year = Number(long[3]);
    if (month === undefined) return null;
    return isRealDate(year, month, day) ? format(year, month, day) : null;
  }

  return null;
}

/** Parse an already-canonical `YYYY-MM-DD` string, or `null` if malformed. */
export function parsePlainDate(raw: string): PlainDate | null {
  const match = PLAIN_DATE_RE.exec(raw.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isRealDate(year, month, day) ? format(year, month, day) : null;
}

/** Render a `Date` as a `PlainDate`, reading its UTC components. */
export function toPlainDate(date: Date): PlainDate {
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Today's date in UTC. Injected explicitly at call sites so tests stay pure. */
export function todayUtc(): PlainDate {
  return toPlainDate(new Date());
}

function toUtcMillis(date: PlainDate): number {
  const match = PLAIN_DATE_RE.exec(date);
  if (!match) throw new Error(`Not a PlainDate: ${JSON.stringify(date)}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** `date` shifted by `days`, which may be negative. */
export function addDays(date: PlainDate, days: number): PlainDate {
  return toPlainDate(new Date(toUtcMillis(date) + days * MS_PER_DAY));
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY);
}

/** Chronological comparator, usable directly in `Array.prototype.sort`. */
export function compareDates(a: PlainDate, b: PlainDate): number {
  return toUtcMillis(a) - toUtcMillis(b);
}

const MONTH_NAMES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function parts(date: PlainDate): { year: number; month: number; day: number } {
  const match = PLAIN_DATE_RE.exec(date);
  if (!match) throw new Error(`Not a PlainDate: ${JSON.stringify(date)}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Render as `15/03/2024`, the convention used on Dominican documents. */
export function formatDominicanDate(date: PlainDate): string {
  const { year, month, day } = parts(date);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** Render as `15 de marzo de 2024`, the long form used in certification prose. */
export function formatLongSpanishDate(date: PlainDate): string {
  const { year, month, day } = parts(date);
  return `${day} de ${MONTH_NAMES_ES[month - 1]} de ${year}`;
}
