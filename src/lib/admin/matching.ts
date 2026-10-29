import type { Candidate, Report, ReportObject, Resort, Row, Source, Status } from "./types";
import { normalizeStatus } from "./validation";

export function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[^a-z0-9]/g, "");
}
function canonical(value: unknown) {
  return norm(String(value ?? "").replace(/\([^)]*\)|\b\d+\s*m\b/gi, "").replace(/^(?:trasa\s+(?:narciarska\s+)?(?:nr\.?\s+)?|kolej\s+(?:krzesełkowa\s+)?|wyciąg\s+)/i, "").replace(/\s+kolej$/i, ""));
}
// Preserve separators: route 4/1 must not match route 41.
function code(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/\s+/g, ""); }
export function score(db: Row, observed: Candidate, kind: "slope" | "lift") {
  if (observed.kind !== kind) return 0;
  const number = code(db.number), other = code(observed.number);
  if (kind === "slope" && number && number === other) return 100;
  // Numeric lift IDs are often ordinal; use a name or a letter code instead.
  if (kind === "lift" && number && number === other && /[a-z]/.test(number)) return 95;
  const name = canonical(db.name);
  return name.length >= 3 && name === canonical(observed.name) ? 90 : 0;
}
export function freshness(value: string | null, now = Date.now()) {
  if (!value) return "brak daty źródła";
  if (!Number.isFinite(Date.parse(value))) return "nieczytelna data";
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) return "nieznana strefa daty";
  const hours = (now - Date.parse(value)) / 3600000;
  return hours < -1 ? "data z przyszłości" : hours > 72 ? "starsze niż 72h" : "do 72h";
}
export type Snapshot = { generated_at: string; resorts: Row[]; slopes: Row[]; lifts: Row[]; sources: Source[] };
export type SourceResult = { source: Source; fetched_at: string; observations: Candidate[]; error?: string; station?: { raw: boolean; note: string } };

export function buildReport(snapshot: Snapshot, results: SourceResult[]): Report {
  const observations = results.flatMap(r => r.observations);
  const objects: ReportObject[] = [];
  for (const [kind, rows] of [["slope", snapshot.slopes], ["lift", snapshot.lifts]] as const) {
    for (const db of rows) {
      const ranked = observations.filter(o => o.resort_id === db.resort).map(o => ({ o, score: score(db, o, kind) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
      const top = ranked.filter(r => r.score === ranked[0]?.score);
      const perSource = new Map<string, number>();
      for (const { o } of top) perSource.set(o.source, (perSource.get(o.source) || 0) + 1);
      const ambiguous = Array.from(perSource.values()).some(n => n > 1);
      const states = new Set(top.map(r => r.o.status));
      const status: Status = !top.length || ambiguous || states.size !== 1 ? "unknown" : top[0].o.status;
      objects.push({ db_id: String(db.id), resort_id: String(db.resort), kind, number: db.number ?? null, name: db.name ?? null, sector: db.sector, length_m: db.length_m ?? null, db_status: db.status ?? null, db_status_norm: normalizeStatus(db.status), db_updated_at: typeof db.updated_at === "string" ? db.updated_at : null, db_record: db, observed_status: status, match: !top.length ? "brak" : ambiguous ? "niejednoznaczne" : states.size > 1 ? "konflikt źródeł" : "propozycja do zatwierdzenia", candidates: top.map(({ o, score }) => ({ ...o, reason: score === 100 ? "ten sam numer trasy" : score === 95 ? "ten sam kod wyciągu" : "ta sama nazwa", freshness: freshness(o.source_updated_at) })) });
    }
  }
  const assigned = new Map<string, ReportObject[]>();
  for (const row of objects) for (const c of row.candidates) assigned.set(c.source_id, [...(assigned.get(c.source_id) || []), row]);
  for (const rows of assigned.values()) if (new Set(rows.map(r => `${r.kind}:${r.db_id}`)).size > 1) for (const row of rows) { row.match = "współdzielone dopasowanie — sprawdź"; row.observed_status = "unknown"; }
  return { generated_at: snapshot.generated_at, counts: { resorts: snapshot.resorts.length, slopes: snapshot.slopes.length, lifts: snapshot.lifts.length, observations: observations.length }, resorts: snapshot.resorts as Resort[], objects, sources: snapshot.sources, unmatched_source_objects: observations.filter(o => !assigned.has(o.source_id)), errors: results.filter(r => r.error).map(r => ({ source: r.source.id, resort_id: r.source.resort_id, url: r.source.url, error: r.error! })) };
}
