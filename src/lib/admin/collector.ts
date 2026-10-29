import "server-only";
import catalog from "./source-catalog.json";
import { listRecords } from "./records";
import { parseSource } from "./parsers";
import type { Snapshot, SourceResult } from "./matching";
import type { Source } from "./types";
import { HttpError } from "./validation";

const sources = catalog as Source[];
export async function databaseSnapshot(): Promise<Snapshot> {
  const [resorts, slopes, lifts] = await Promise.all([listRecords("resorts"), listRecords("slopes"), listRecords("lifts")]);
  const ids = new Set(resorts.map(r => String(r.id)));
  return { generated_at: new Date().toISOString(), resorts, slopes, lifts, sources: sources.filter(s => ids.has(s.resort_id)).map(({ id, resort_id, url, adapter, expected_station, kind, legacy, force_kind }) => ({ id, resort_id, url, adapter, expected_station, kind, legacy, force_kind })) };
}
const canonicalHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
export async function checkSource(id: unknown): Promise<SourceResult> {
  const source = sources.find(s => s.id === id);
  if (!source) throw new HttpError(400, "Nieznane źródło. Wybierz źródło przypisane do ośrodka.");
  const fetched_at = new Date().toISOString();
  try {
    // Neither the request body nor database URLs can provide a fetch destination.
    let url = new URL(source.url);
    const host = canonicalHost(url.hostname);
    const signal = AbortSignal.timeout(10000);
    let response: Response | undefined;
    for (let redirect = 0; redirect <= 4; redirect++) {
      if (!["https:", "http:"].includes(url.protocol) || canonicalHost(url.hostname) !== host || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Przekierowanie poza domenę źródła — sprawdź ręcznie.");
      response = await fetch(url, { signal, redirect: "manual", cache: "no-store", headers: { "User-Agent": "OtwarteStoki-StatusReview/1.0 (+https://www.otwartestoki.pl)", Accept: "text/html,application/json" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirect === 4) throw new Error("Nie udało się rozwiązać przekierowania źródła.");
        url = new URL(location, url); continue;
      }
      break;
    }
    if (!response?.ok) { await response?.body?.cancel(); throw new Error(`Źródło zwróciło HTTP ${response?.status || "błąd"}.`); }
    if (!response.body) throw new Error("Pusta odpowiedź źródła.");
    const limit = 3_000_000;
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("Strona przekracza limit 3 MB."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const charset = response.headers.get("content-type")?.match(/charset=["']?([a-zA-Z0-9-]+)/)?.[1] || "utf-8";
    const content = new TextDecoder(charset).decode(raw);
    const observations = parseSource(source, content);
    if (!observations.length) throw new Error("Brak rozpoznanych pojedynczych tras lub wyciągów. Sprawdź stronę ręcznie.");
    if (observations.length > 2000) throw new Error("Nietypowo dużo obiektów — źródło wymaga sprawdzenia.");
    for (const row of observations) {
      row.fetched_at = fetched_at;
      row.warnings = row.status === "open" && /ośrodek nieczynny|stacja nieczynna/i.test(content) ? ["Źródło informuje również o nieczynnym ośrodku. Sprawdź datę i ruch turystyczny."] : [];
      if (JSON.stringify(row.evidence).length > 3000) row.evidence = null;
    }
    let station: SourceResult["station"];
    if (source.adapter === "berg") {
      const data = JSON.parse(content);
      if (typeof data.skiStationOpen === "boolean") station = { raw: data.skiStationOpen, note: "Deklaracja źródła może obejmować ruch turystyczny; nie ustala automatycznie narciarskiego statusu ośrodka." };
    }
    return { source, fetched_at, observations, station };
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return { source, fetched_at, observations: [], error: timeout ? "Źródło nie odpowiedziało w ciągu 10 sekund." : error instanceof SyntaxError ? "Źródło zwróciło nieprawidłowy JSON." : error instanceof Error ? error.message : "Nie udało się odczytać źródła." };
  }
}
