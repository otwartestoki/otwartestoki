import type { Candidate, Report, ReportObject, Resort, Row, Source, Status } from "./types";
import { normalizeStatus } from "./validation";

export function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[^a-z0-9]/g, "");
}
function canonical(value: unknown) {
  return norm(String(value ?? "").replace(/\([^)]*\)|\b\d+\s*m\b/gi, "").replace(/^(?:(?:trasa\s+(?:narciarska\s+)?(?:nr\.?\s+)?|kolej\s+(?:(?:linowa|krzesełkowa)\s+)?|wyciąg\s+(?:(?:narciarski|orczykowy|taśmowy|talerzykowy)\s+)?|przenośnik\s+taśmowy\s+))+/i, "").replace(/\s+(?:kolej|polana)$/i, ""));
}
function liftClass(value: unknown) {
  const name = norm(value);
  return /tasm|przenosnik|conveyor|sunkid/.test(name) ? "conveyor" : /krzes|kanap|chair/.test(name) ? "chair" : /gondol|cablecar/.test(name) ? "gondola" : /orczyk|talerz|drag|surface/.test(name) ? "drag" : null;
}
// Preserve separators: route 4/1 must not match route 41.
function code(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/\s+/g, ""); }
export function score(db: Row, observed: Candidate, kind: "slope" | "lift") {
  if (observed.kind !== kind) return 0;
  const number = code(db.number), other = code(observed.number);
  if (kind === "slope" && number && number === other) return 100;
  // Numeric lift IDs are often ordinal; use a name or a letter code instead.
  const name = canonical(db.name);
  const sameName = name.length >= 3 && name === canonical(observed.name);
  if (kind === "lift") {
    const sameCode = Boolean(number && number === other && /[a-z]/.test(number));
    if (!sameName && !sameCode) return 0;
    const base = sameName && sameCode ? 120 : sameName ? 100 : 95;
    const dbType = liftClass(db.type), sourceType = liftClass(observed.name);
    return base + (dbType && sourceType ? dbType === sourceType ? 3 : -3 : 0);
  }
  return sameName ? 90 : 0;
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
      objects.push({ db_id: String(db.id), resort_id: String(db.resort), kind, number: db.number ?? null, name: db.name ?? null, sector: db.sector, length_m: db.length_m ?? null, db_status: db.status ?? null, db_status_norm: normalizeStatus(db.status), db_updated_at: typeof db.updated_at === "string" ? db.updated_at : null, db_record: db, observed_status: status, match: !top.length ? "brak" : ambiguous ? "niejednoznaczne" : states.size > 1 ? "konflikt źródeł" : "propozycja do zatwierdzenia", candidates: top.map(({ o }) => ({ ...o, reason: kind === "slope" && code(db.number) && code(db.number) === code(o.number) ? "ten sam numer trasy" : kind === "lift" && code(db.number) && code(db.number) === code(o.number) ? "ten sam kod wyciągu" : "ta sama nazwa po usunięciu opisu typu", freshness: freshness(o.source_updated_at) })) });
    }
  }
  // A unique length is a clue for manual identity review, never an automatic match.
  const metres = (value: unknown) => /^\d+$/.test(String(value ?? "").trim()) && Number(value) > 0 ? Number(value) : null;
  for (const row of objects) {
    if (row.candidates.length || String(row.name ?? "").trim() || !metres(row.length_m)) continue;
    const peers = objects.filter(other => other.resort_id === row.resort_id && other.kind === row.kind && metres(other.length_m) === metres(row.length_m));
    if (peers.length !== 1) continue;
    const possible = observations.filter(o => o.resort_id === row.resort_id && o.kind === row.kind && !o.number && metres(o.length_m) === metres(row.length_m));
    const perSource = new Map<string, number>();
    for (const o of possible) perSource.set(o.source, (perSource.get(o.source) || 0) + 1);
    if (!possible.length || Array.from(perSource.values()).some(count => count > 1)) continue;
    row.match = "możliwe dopasowanie po długości — sprawdź nazwę i kod";
    row.candidates = possible.map(o => ({ ...o, reason: "Jedyna zgodna długość w tym ośrodku i typie obiektu. To nie potwierdza tożsamości; porównaj obiekt na stronie źródłowej.", freshness: freshness(o.source_updated_at) }));
    row.observed_status = "unknown";
  }
  const assigned = new Map<string, ReportObject[]>();
  for (const row of objects) for (const c of row.candidates) assigned.set(c.source_id, [...(assigned.get(c.source_id) || []), row]);
  for (const rows of assigned.values()) if (new Set(rows.map(r => `${r.kind}:${r.db_id}`)).size > 1) for (const row of rows) { row.match = "współdzielone dopasowanie — sprawdź"; row.observed_status = "unknown"; }
  return { generated_at: snapshot.generated_at, counts: { resorts: snapshot.resorts.length, slopes: snapshot.slopes.length, lifts: snapshot.lifts.length, observations: observations.length }, resorts: snapshot.resorts as Resort[], objects, sources: snapshot.sources, unmatched_source_objects: observations.filter(o => !assigned.has(o.source_id)), errors: results.filter(r => r.error).map(r => ({ source: r.source.id, resort_id: r.source.resort_id, url: r.source.url, error: r.error! })) };
}
