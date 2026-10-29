import type { Field, Row, TableSchema } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_ERROR", public current?: Row) { super(message); }
}
export function normalizeStatus(value: unknown): "open" | "closed" | "unknown" {
  const s = String(value ?? "").trim().toLowerCase();
  if (["open", "otwarty", "otwarta", "otwarte", "czynny", "czynna", "czynne"].includes(s)) return "open";
  if (["closed", "zamknięty", "zamknięta", "zamknięte", "nieczynny", "nieczynna", "nieczynne"].includes(s)) return "closed";
  return "unknown";
}
export function allowlisted(email: string | undefined, confirmed: boolean, setting: string | undefined): boolean {
  if (!email || !confirmed || !setting) return false;
  return setting.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
export function recordIdentity(spec: TableSchema, input: unknown): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Nieprawidłowy identyfikator.");
  const value = input as Row;
  if (Object.keys(value).sort().join() !== [...spec.keys].sort().join() || spec.keys.some(k => !["string", "number"].includes(typeof value[k]) || String(value[k]).length > 200 || (typeof value[k] === "number" && !Number.isSafeInteger(value[k])))) throw new HttpError(400, "Nieprawidłowy identyfikator.");
  return value;
}
function validateField(f: Field, value: unknown, before: Row): void {
  if (value === null) { if (f.required) throw new HttpError(400, `${f.label}: wartość jest wymagana.`); return; }
  if (["number", "integer"].includes(f.type)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e8 || (f.type === "integer" && !Number.isInteger(value))) throw new HttpError(400, `${f.label}: nieprawidłowa liczba.`);
    return;
  }
  if (typeof value !== "string" || value.length > 10000 || (f.required && !value.trim())) throw new HttpError(400, `${f.label}: nieprawidłowa wartość.`);
  if (f.type === "select" && !f.options?.includes(value) && value !== before[f.key]) throw new HttpError(400, `${f.label}: wybierz dostępną wartość.`);
  if (f.type === "url" && value) { try { if (!["https:", "http:"].includes(new URL(value).protocol)) throw Error(); } catch { throw new HttpError(400, `${f.label}: nieprawidłowy adres URL.`); } }
  if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new HttpError(400, `${f.label}: nieprawidłowa data.`);
}
export function validateChanges(spec: TableSchema, input: unknown, before: Row): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Nieprawidłowe zmiany.");
  const allowed = new Map(spec.fields.filter(f => f.key in before).map(f => [f.key, f]));
  const result: Row = {};
  for (const [key, value] of Object.entries(input)) {
    const field = allowed.get(key);
    if (!field) throw new HttpError(400, `Pole ${key} nie jest edytowalne.`);
    validateField(field, value, before);
    if (JSON.stringify(value) !== JSON.stringify(before[key])) result[key] = value;
  }
  return result;
}
export function changed(row: { match: string; observed_status: string; db_status_norm: string }): boolean {
  return row.match === "propozycja do zatwierdzenia" && ["open", "closed"].includes(row.observed_status) && row.observed_status !== row.db_status_norm;
}
