import type { Candidate, ReportObject } from "./types";

export type ComparisonState = "same" | "different" | "missing";
export type WritableSourceField = "number" | "name" | "length_m" | "status";
export type ComparisonField = { key: "kind" | WritableSourceField; label: string; database: string; source: string; state: ComparisonState };
const scalar = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value).trim().replace(/\s+/g, " ") : "";
const label = (value: unknown) => scalar(value) || "brak danych";
const names = (value: unknown) => scalar(value).normalize("NFKC").toLocaleLowerCase("pl");
const codes = (value: unknown) => names(value).replace(/\s+/g, "");
const statusLabels = { open: "otwarte", closed: "zamknięte", partial: "częściowo otwarte", unknown: "nieznany" };

// Accept one explicit measurement only; ranges or multiple lengths stay uncomparable.
export function metres(value: unknown): number | null {
  const match = scalar(value).toLowerCase().replace(/\s/g, "").match(/^(\d+(?:[.,]\d+)?)(km|m)?$/);
  if (!match) return null;
  const amount = Number(match[1].replace(",", ".")) * (match[2] === "km" ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
function compare(a: unknown, b: unknown, normalize = names): ComparisonState {
  return !scalar(a) || !scalar(b) ? "missing" : normalize(a) === normalize(b) ? "same" : "different";
}
export function sourceFieldValue(field: WritableSourceField, candidate: Candidate): string | number | undefined {
  if (field === "number" || field === "name") return scalar(candidate[field]) || undefined;
  if (field === "length_m") { const length = metres(candidate.length_m); return length !== null && length <= 1e8 ? length : undefined; }
  if (field === "status") return candidate.status === "open" ? "otwarta" : candidate.status === "closed" ? "zamknięta" : undefined;
  return undefined;
}
export function compareCandidate(row: ReportObject, candidate: Candidate): ComparisonField[] {
  const dbLength = metres(row.length_m), sourceLength = metres(candidate.length_m);
  return [
    { key: "kind", label: "Typ", database: row.kind === "slope" ? "Trasa" : "Wyciąg", source: candidate.kind === "slope" ? "Trasa" : "Wyciąg", state: row.kind === candidate.kind ? "same" : "different" },
    { key: "number", label: "Numer / kod", database: label(row.number), source: label(candidate.number), state: compare(row.number, candidate.number, codes) },
    { key: "name", label: "Nazwa", database: label(row.name), source: label(candidate.name), state: compare(row.name, candidate.name) },
    { key: "length_m", label: "Długość", database: dbLength === null ? label(row.length_m) : `${dbLength} m`, source: sourceLength === null ? label(candidate.length_m) : /(?:km|m)$/i.test(scalar(candidate.length_m)) ? label(candidate.length_m) : `${sourceLength} m`, state: dbLength === null || sourceLength === null ? "missing" : Math.abs(dbLength - sourceLength) < 0.01 ? "same" : "different" },
    { key: "status", label: "Status", database: label(row.db_status), source: statusLabels[candidate.status], state: row.db_status_norm === "unknown" || candidate.status === "unknown" ? "missing" : row.db_status_norm === candidate.status ? "same" : "different" },
  ];
}
