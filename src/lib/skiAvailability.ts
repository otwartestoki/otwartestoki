export type SkiStatus = "open" | "closed" | "unknown";
export type SlopeAvailability = { resort: string | number | null; status: string | null };
export type SlopeSummary = { total: number; open: number; closed: number; unknown: number };
export const STATUS_CONFIRMATION_HOURS = 72;

export function normalizeSkiStatus(value: unknown): SkiStatus {
  const text = String(value ?? "").trim().toLowerCase();
  if (["open", "opened", "otwarty", "otwarta", "otwarte", "czynny", "czynna", "czynne"].includes(text)) return "open";
  if (["closed", "zamkniety", "zamknięty", "zamknieta", "zamknięta", "zamkniete", "zamknięte", "nieczynny", "nieczynna", "nieczynne"].includes(text)) return "closed";
  return "unknown";
}
export function summarizeSlopes(slopes: SlopeAvailability[]): Map<string, SlopeSummary> {
  const result = new Map<string, SlopeSummary>();
  for (const slope of slopes) {
    if (slope.resort === null) continue;
    const key = String(slope.resort), row = result.get(key) || { total: 0, open: 0, closed: 0, unknown: 0 };
    row.total++; row[normalizeSkiStatus(slope.status)]++; result.set(key, row);
  }
  return result;
}
export function utcTimestamp(value: unknown): number {
  if (typeof value !== "string" || !value) return NaN;
  // Existing last_checked_at is a timestamp without time zone, stored as UTC.
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`);
}
export function freshStatusConfirmation(value: string | null | undefined, now = Date.now()): boolean {
  const stamp = utcTimestamp(value);
  const age = now - stamp;
  return Number.isFinite(age) && age >= -3600000 && age <= STATUS_CONFIRMATION_HOURS * 3600000;
}
export function publicSkiStatus(manual: unknown, checkedAt: string | null | undefined, slopes: SlopeSummary | undefined, now = Date.now()): SkiStatus {
  // A tourist lift must never open a ski resort with every ski run closed.
  if (slopes && slopes.total > 0 && slopes.closed === slopes.total) return "closed";
  if (normalizeSkiStatus(manual) === "closed" && freshStatusConfirmation(checkedAt, now)) return "closed";
  // Editing a name/length or fetching a page does not confirm an open status.
  if (!freshStatusConfirmation(checkedAt, now)) return "unknown";
  if (normalizeSkiStatus(manual) === "open" && slopes && slopes.open > 0) return "open";
  return "unknown";
}
