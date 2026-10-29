"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, Shell } from "../client";
import { changed } from "@/lib/admin/validation";
import { buildReport, type Snapshot, type SourceResult } from "@/lib/admin/matching";
import type { ReportObject, Row, Status } from "@/lib/admin/types";

const labels: Record<Status, string> = { open: "otwarte", closed: "zamknięte", partial: "częściowo otwarte", unknown: "brak jednoznacznych danych" };
const keyOf = (row: ReportObject) => `${row.kind}:${row.db_id}`;
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString("pl-PL") : "brak daty";
const safeUrl = (value: unknown) => typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined;

export default function Page() { return <Shell><LiveStatuses /></Shell>; }

function LiveStatuses() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"idle" | "read" | "scan" | "save">("read");
  const [message, setMessage] = useState("");
  const [resortId, setResortId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stop = useRef(false);
  const busy = phase !== "idle";
  const report = useMemo(() => snapshot ? buildReport(snapshot, results) : null, [snapshot, results]);

  useEffect(() => {
    let active = true;
    api<Snapshot>("snapshot").then(data => { if (active) setSnapshot(data); }).catch(e => { if (active) setMessage(e.message); }).finally(() => { if (active) setPhase("idle"); });
    return () => { active = false; stop.current = true; };
  }, []);

  async function read() {
    setPhase("read"); setMessage("");
    try { const data = await api<Snapshot>("snapshot"); setSnapshot(data); setResults([]); setSelected(new Set()); setReceipts({}); setProgress({ done: 0, total: 0 }); setMessage("Odczytano aktualny stan Supabase."); }
    catch (e) { setMessage((e as Error).message); }
    finally { setPhase("idle"); }
  }

  async function scan() {
    setPhase("scan"); stop.current = false; setMessage("Odczytuję aktualny stan bazy przed sprawdzeniem stron…"); setSelected(new Set()); setReceipts({}); setResults([]);
    try {
      const data = await api<Snapshot>("snapshot"); setSnapshot(data);
      const sources = data.sources.filter(s => !resortId || s.resort_id === resortId);
      setProgress({ done: 0, total: sources.length });
      if (!sources.length) { setMessage("Ten ośrodek nie ma jeszcze automatycznego źródła. Możesz otworzyć jego stronę i użyć edytora bazy."); return; }
      let done = 0, errors = 0;
      // Two bounded requests at a time; no single request processes the entire catalog.
      for (let start = 0; start < sources.length && !stop.current; start += 2) {
        const batch = sources.slice(start, start + 2);
        const names = batch.map(s => data.resorts.find(r => r.id === s.resort_id)?.name || s.id).join(", ");
        setMessage(`Sprawdzam: ${names}. Gotowe ${done} z ${sources.length} źródeł.`);
        const checked = await Promise.all(batch.map(async source => {
          try { return await api<SourceResult>("check-source", { source_id: source.id }); }
          catch (e) { return { source, fetched_at: new Date().toISOString(), observations: [], error: (e as Error).message } satisfies SourceResult; }
        }));
        done += checked.length; errors += checked.filter(r => r.error).length;
        setResults(old => [...old, ...checked]); setProgress({ done, total: sources.length });
      }
      setMessage(`${stop.current ? "Zatrzymano" : "Zakończono sprawdzanie"}: ${done} z ${sources.length} źródeł. ${errors ? `${errors} źródeł wymaga sprawdzenia ręcznego.` : ""} Przejrzyj propozycje i wybierz zmiany do zapisu.`);
    } catch (e) { setMessage((e as Error).message); }
    finally { setPhase("idle"); }
  }

  async function save() {
    if (!report) return;
    const rows = report.objects.filter(row => selected.has(keyOf(row)) && changed(row));
    setPhase("save"); stop.current = false; let done = 0;
    try {
      for (const row of rows) {
        if (stop.current) break;
        const key = keyOf(row);
        setMessage(`Zapis ${done + 1} z ${rows.length}: ${String(row.name || row.number)}. Nie zamykaj strony.`);
        try {
          const data = await api("proposal", { table: row.kind === "slope" ? "slopes" : "lifts", id: Number(row.db_id), resort: row.resort_id, before: row.db_status, updated_at: row.db_updated_at, target: row.observed_status });
          setSnapshot(old => {
            if (!old) return old;
            const field = row.kind === "slope" ? "slopes" : "lifts";
            return { ...old, [field]: old[field].map((r: Row) => String(r.id) === row.db_id ? data.record : r) };
          });
          setReceipts(old => ({ ...old, [key]: "Potwierdzono status w bazie." }));
          setSelected(old => { const next = new Set(old); next.delete(key); return next; }); done++;
        } catch (e) {
          setReceipts(old => ({ ...old, [key]: (e as Error).message }));
          setMessage(`Potwierdzono ${done} zmian. Zatrzymano po błędzie. Sprawdź aktualny wpis i historię przed ponowieniem.`); return;
        }
      }
      setMessage(`Potwierdzono ${done} zmian.${stop.current ? " Zatrzymano kolejkę." : ""}`);
    } finally { setPhase("idle"); }
  }

  const visible = report?.objects.filter(row => (!resortId || row.resort_id === resortId) && (!search || `${row.name || ""} ${row.number || ""} ${snapshot?.resorts.find(r => r.id === row.resort_id)?.name}`.toLocaleLowerCase("pl").includes(search.toLocaleLowerCase("pl"))) && (filter === "changes" ? changed(row) : filter === "issues" ? !row.candidates.length || row.observed_status === "unknown" || row.match !== "propozycja do zatwierdzenia" : true)) || [];
  const proposed = report?.objects.filter(changed) || [];
  const eligible = visible.filter(changed);
  const groups = snapshot?.resorts.filter(r => (!resortId || r.id === resortId) && (visible.some(o => o.resort_id === r.id) || (filter === "all" && !search))) || [];

  return <>
    <h1>Aktualizacje statusów</h1>
    <p>Aktualny obraz bazy Supabase. Sprawdź strony ośrodków, porównaj wyniki i zaakceptuj wybrane zmiany.</p>
    <div className="toolbar">
      <button disabled={busy} onClick={read}>Odśwież bazę</button>
      <button className="primary" disabled={busy || !snapshot} onClick={scan}>Sprawdź źródła{resortId ? " ośrodka" : " wszystkich ośrodków"}</button>
      {(phase === "scan" || phase === "save") && <button onClick={() => { stop.current = true; }}>Zatrzymaj po bieżących operacjach</button>}
      <a href="/admin/baza">Edytuj wpisy ręcznie</a>
    </div>
    {phase === "read" && <p role="status">Odczytuję bazę Supabase…</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {progress.total > 0 && <div className="scan-progress"><progress value={progress.done} max={progress.total} aria-label="Postęp sprawdzania źródeł" /><span>{progress.done} / {progress.total} źródeł</span></div>}
    {snapshot && report && <>
      <div className="status-stats"><article><b>{snapshot.resorts.length}</b><small>ośrodków</small></article><article><b>{snapshot.slopes.length}</b><small>tras w bazie</small></article><article><b>{snapshot.lifts.length}</b><small>wyciągów w bazie</small></article><article><b>{proposed.length}</b><small>propozycji zmian</small></article></div>
      <small>Odczyt bazy: {date(snapshot.generated_at)}. {snapshot.sources.length} przypisanych źródeł. Czas pobrania strony nie jest datą aktualizacji danych ośrodka.</small>
      <div className="toolbar">
        <label>Ośrodek<select value={resortId} disabled={busy} onChange={e => setResortId(e.target.value)}><option value="">Wszystkie ośrodki</option>{snapshot.resorts.map(r => <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>)}</select></label>
        <label>Szukaj<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nazwa lub numer trasy, wyciągu…" /></label>
        <label>Pokaż<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Całą bazę</option><option value="changes">Propozycje zmian</option><option value="issues">Braki i niejednoznaczne wyniki</option></select></label>
      </div>
      <div className="toolbar">
        <button disabled={busy || !eligible.length} onClick={() => setSelected(new Set(eligible.map(keyOf)))}>Wybierz widoczne propozycje ({eligible.length})</button>
        <button disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Odznacz</button>
        <button className="primary" disabled={busy || !selected.size} onClick={save}>Zapisz zaakceptowane ({selected.size})</button>
      </div>
      {!results.length && phase !== "scan" && <p>Widzisz wartości zapisane w bazie. Kliknij „Sprawdź źródła”, aby pobrać propozycje z internetu. Samo sprawdzanie nie zmienia bazy.</p>}
      {!groups.length && <p>Brak wpisów spełniających wybrane filtry.</p>}
      <div className="records">{groups.map(resort => {
        const id = String(resort.id), rows = visible.filter(r => r.resort_id === id), sources = snapshot.sources.filter(s => s.resort_id === id), checked = results.filter(r => r.source.resort_id === id), differences = rows.filter(changed), extras = report.unmatched_source_objects?.filter(o => o.resort_id === id) || [];
        return <details className="resort-status" key={id} open={Boolean(resortId) || filter === "changes"}>
          <summary><strong>{String(resort.name)}</strong><span>{String(resort.status || "brak statusu")} · {rows.length} obiektów · {differences.length} propozycji</span></summary>
          <div className="resort-status-body">
            <p>Status ośrodka w bazie: <b>{String(resort.status || "brak")}</b> · sprawdzony: {date(typeof resort.last_checked_at === "string" ? resort.last_checked_at : null)}</p>
            {safeUrl(resort.url) && <p><a href={safeUrl(resort.url)} target="_blank" rel="noreferrer">Otwórz stronę ośrodka ↗</a></p>}
            {!sources.length ? <p className="source-warning">Brak przypisanego automatycznego źródła. Obiekty pozostają widoczne w bazie; sprawdź stronę ośrodka ręcznie.</p> : <p>Sprawdzono {checked.length} z {sources.length} przypisanych źródeł.</p>}
            {checked.map(r => <div className={r.error ? "source-warning" : "source-result"} key={r.source.id}><a href={r.source.url} target="_blank" rel="noreferrer">{new URL(r.source.url).hostname} ↗</a> · {r.error || `${r.observations.length} odczytanych obiektów`}<small>Pobrano: {date(r.fetched_at)}</small>{r.station && <p>Deklaracja stacji w źródle: {r.station.raw ? "otwarta" : "zamknięta"}. {r.station.note}</p>}</div>)}
            <div className="status-table-wrap"><table className="status-table"><thead><tr><th>Obiekt</th><th>Aktualnie w bazie</th><th>Odczyt ze źródła</th><th>Akceptacja</th></tr></thead><tbody>{rows.map(row => {
              const key = keyOf(row);
              return <tr key={key}><td><small>{row.kind === "slope" ? "Trasa" : "Wyciąg"}</small><strong>{String(row.number || "")} {String(row.name || "bez nazwy")}</strong>{row.sector && <small>Sektor: {String(row.sector)}</small>}</td><td><span className={`status-pill ${row.db_status_norm}`}>{String(row.db_status || "brak")}</span><small>{date(row.db_updated_at)}</small></td><td>{row.candidates.length ? <><span className={`status-pill ${row.observed_status}`}>{labels[row.observed_status]}</span>{row.match !== "propozycja do zatwierdzenia" && <small>{row.match}</small>}<details><summary>Źródło i data ({row.candidates.length})</summary>{row.candidates.map((c, i) => <div className="candidate" key={i}><a href={c.url} target="_blank" rel="noreferrer">{c.name || c.source} ↗</a><small>Odczyt: {String(c.raw_status ?? "brak")} · {c.reason}</small><small>Data źródła: {c.source_updated_at || "brak daty"} · {c.freshness}</small><small>Pobrano: {date(c.fetched_at)}</small>{c.warnings?.map(w => <p className="source-warning" key={w}>{w}</p>)}</div>)}</details></> : <small>{checked.length ? "Brak dopasowania — sprawdź ręcznie" : "Jeszcze nie sprawdzono"}</small>}</td><td>{changed(row) ? <label><input type="checkbox" disabled={busy} checked={selected.has(key)} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(key); else next.delete(key); return next; })} />Zatwierdź</label> : <small>{row.candidates.length && row.db_status_norm === row.observed_status ? "Zgodne z bazą" : "—"}</small>}{receipts[key] && <p role="status">{receipts[key]}</p>}</td></tr>;
            })}</tbody></table></div>
            {extras.length > 0 && <details><summary>Obiekty źródłowe bez dopasowania w bazie ({extras.length})</summary>{extras.map((o, i) => <p key={i}>{o.kind === "slope" ? "Trasa" : "Wyciąg"} {o.number} {o.name} · {labels[o.status]} · <a href={o.url} target="_blank" rel="noreferrer">źródło ↗</a></p>)}</details>}
          </div>
        </details>;
      })}</div>
    </>}
  </>;
}
