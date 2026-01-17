"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, useSearchParams } from "next/navigation";

/* ===================== TYPES ===================== */

type ResortRow = {
  id: number | string;
  name: string | null;
  region: string | null;
  city: string | null;

  country: string | null;

  status_raw: string | null;
  status_norm: "open" | "closed" | string | null;

  last_checked_at: string | null;
  url: string | null;

  // stats “spłaszczone”
  slopes_open: number | null;
  slopes_total: number | null;
  open_km: number | null;
  total_km: number | null;

  lifts_open: number | null;
  lifts_total: number | null;

  lifts_capacity_open_pph: number | null;

  skipass_price: number | null;
  skipass_currency: string | null;
  skipass_url: string | null;
  skipass_label: string | null;

  stats_updated_at: string | null;

  has_open_kids_tape?: boolean | null;

  total_count?: number | null;

  resort_updated_at?: string | null;
};

type DifficultyOption = "green" | "blue" | "red" | "black";
// ✅ multi-select; pusty array = wszystkie
type DifficultyFilter = DifficultyOption[];
type SortKey = "open_km_desc" | "comfort_desc" | "pph_desc" | "updated_desc" | "price_asc";

// ✅ multi-select; pusty array = wszystkie
type RegionFilter = string[];
type CountryFilter = string[];

/* ===================== CONST ===================== */

const PAGE_SIZE = 15;

/* ===================== HELPERS ===================== */

function normalizeResortStatus(s?: string | null) {
  const v = (s ?? "").toLowerCase().trim();
  if (["open", "otwarty", "otwarta", "otwarte", "opened"].includes(v)) return "open";
  if (["closed", "zamkniety", "zamknięty", "zamknieta", "zamknięta", "zamkniete", "zamknięte"].includes(v)) return "closed";
  return "closed";
}

function statusLabel(s: string) {
  return s === "open" ? "Otwarte" : "Zamknięte";
}

function statusPillStyle(s: string) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid",
    whiteSpace: "nowrap" as const,
  };
  if (s === "open") return { ...base, background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" };
  return { ...base, background: "#f8fafc", borderColor: "#e2e8f0", color: "#334155" };
}

function dotStyle(s: string) {
  const base = { width: 8, height: 8, borderRadius: 999, display: "inline-block" as const };
  return s === "open" ? { ...base, background: "#16a34a" } : { ...base, background: "#94a3b8" };
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", hourCycle: "h23" });
}

function fmtDateShort(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    hourCycle: "h23",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

function fmtMoney(x: number, currency: string) {
  const cur = (currency ?? "PLN").toUpperCase();
  if (cur === "PLN") return x.toLocaleString("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });
  return `${x.toFixed(0)} ${cur}`;
}

function n0(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtPPH(v: any) {
  const n = n0(v);
  if (!n) return "—";
  return `${n.toLocaleString("pl-PL")} /h`;
}

function difficultyLabel(option: DifficultyOption) {
  if (option === "green") return "Zielone / łatwe";
  if (option === "blue") return "Niebieskie / średnie";
  if (option === "red") return "Czerwone / trudne";
  return "Czarne / bardzo trudne";
}

function difficultySetLabel(sel: DifficultyFilter) {
  if (!sel.length) return "Wszystkie";
  if (sel.length === 1) return difficultyLabel(sel[0]);
  return sel.map(difficultyLabel).join(" • ");
}

function difficultyColor(option: DifficultyOption) {
  if (option === "green") return "#16a34a";
  if (option === "blue") return "#2563eb";
  if (option === "red") return "#dc2626";
  return "#0f172a";
}

function sortLabel(k: SortKey) {
  switch (k) {
    case "open_km_desc":
      return "Otwarte km ↓";
    case "comfort_desc":
      return "Komfort (PPH / km) ↓";
    case "pph_desc":
      return "Przepustowość (PPH) ↓";
    case "updated_desc":
      return "Aktualizacja ↓";
    case "price_asc":
      return "Cena skipassa ↑";
    default:
      return "Otwarte km ↓";
  }
}

function slugifyPL(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function resortSlug(r: { name?: string | null; city?: string | null; region?: string | null; country?: string | null }) {
  const parts = [r.name, r.city, r.region, r.country].filter((x) => x && String(x).trim().length) as string[];
  const base = parts.join(" ");
  const slug = slugifyPL(base);
  return slug.length ? slug : "resort";
}

function resortPath(r: { id: any; name?: string | null; city?: string | null; region?: string | null; country?: string | null }) {
  return `/resort/${resortSlug(r)}--${r.id}`;
}

function normKey(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function tsMs(x?: string | null) {
  if (!x) return 0;
  const t = new Date(x).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** ✅ Mobile: skróć długi opis skipassa (żeby nie rozpychał kart) */
function shortSkipassLabel(label?: string | null) {
  const s = String(label ?? "").trim();
  if (!s) return null;

  const m = s.match(/(^|\s)(\d{1,2})\s*(h|hr|hrs|hour|hours|godz|godz\.|godzina|godziny)\b/i);
  if (m) return `${m[2]}h`;

  const d = s.match(/(^|\s)(\d{1,2})\s*(day|days|dzień|dzien|dni)\b/i);
  if (d) return `${d[2]}d`;

  return s.length > 18 ? s.slice(0, 18).trim() + "…" : s;
}

/* ===================== COMPONENT ===================== */

export default function HomeClient() {
  const router = useRouter();
  const params = useSearchParams();
  const forcedView = (params.get("view") ?? "").toLowerCase();
  const forceCards = forcedView === "cards";
  const forceTable = forcedView === "table";

  const [rows, setRows] = useState<ResortRow[]>([]);
  // ✅ pełna lista po filtrach (do budowania opcji w filtrach)
  const [filterBaseRows, setFilterBaseRows] = useState<ResortRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [globalStatsUpdatedAt, setGlobalStatsUpdatedAt] = useState<string | null>(null);
  const [tiles, setTiles] = useState<{ open: number; closed: number }>({ open: 0, closed: 0 });

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("open_km_desc");

  const [difficulty, setDifficulty] = useState<DifficultyFilter>([]); // [] = wszystkie
  const [kidsTapeOnly, setKidsTapeOnly] = useState(false);
  // ✅ slider 0..3 km (na mobile czytelny zakres)
  const [minOpenKm, setMinOpenKm] = useState<number>(0);

  const [regionFilter, setRegionFilter] = useState<RegionFilter>([]); // [] = wszystkie
  const [countryFilter, setCountryFilter] = useState<CountryFilter>([]); // [] = wszystkie


  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // sheet (draft)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dDifficulty, setDDifficulty] = useState<DifficultyFilter>([]);
  const [dKidsTapeOnly, setDKidsTapeOnly] = useState(false);
  const [dMinOpenKm, setDMinOpenKm] = useState<number>(0);
  const [dRegion, setDRegion] = useState<RegionFilter>([]);
  const [dCountry, setDCountry] = useState<CountryFilter>([]);


  function openFilters() {
    setDDifficulty(difficulty);
    setDKidsTapeOnly(kidsTapeOnly);
    setDMinOpenKm(minOpenKm);
    setDRegion(regionFilter);
    setDCountry(countryFilter);
    setFiltersOpen(true);
  }

  function applyFilters() {
    setDifficulty(dDifficulty);
    setKidsTapeOnly(dKidsTapeOnly);
    setMinOpenKm(dMinOpenKm);
    setRegionFilter(dRegion);
    setCountryFilter(dCountry);
    setFiltersOpen(false);
  }

  function resetDraft() {
    setDDifficulty([]);
    setDKidsTapeOnly(false);
    setDMinOpenKm(0);
    setDRegion([]);
    setDCountry([]);
  }

  const activeFiltersCount = useMemo(() => {
    let c = 0;
    if (q.trim().length) c += 1;
    if (countryFilter.length) c += 1;
    if (regionFilter.length) c += 1;
    if (difficulty.length) c += 1;
    if (kidsTapeOnly) c += 1;
    if (minOpenKm > 0) c += 1;
    return c;
  }, [q, difficulty, kidsTapeOnly, minOpenKm, regionFilter, countryFilter]);

  /** Opcje region/kraj budujemy z aktualnie pobranych rekordów (OK do wyboru; filtr robi DB globalnie) */
  const regionOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of filterBaseRows) {
      const v = (r.region ?? "").trim();
      if (!v) continue;
      set.set(normKey(v), v);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "pl"));
  }, [filterBaseRows]);

  const countryOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of filterBaseRows) {
      const v = (r.country ?? "").trim();
      if (!v) continue;
      set.set(normKey(v), v);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "pl"));
  }, [filterBaseRows]);

  // ✅ slider: maksymalnie 3 km na pełną szerokość ekranu
  const maxOpenKmForSlider = 3;

  async function loadGlobalStatsUpdatedAt() {
    const { data, error } = await supabase
      .from("resorts_public_list")
      .select("stats_updated_at")
      .not("stats_updated_at", "is", null)
      .order("stats_updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[loadGlobalStatsUpdatedAt]", error);
      setGlobalStatsUpdatedAt(null);
      return;
    }

    setGlobalStatsUpdatedAt((data as any)?.[0]?.stats_updated_at ?? null);
  }

  // ✅ Tiles (Otwarte/Zamknięte) liczymy na podstawie przefiltrowanych wyników w `load()`

  async function load() {
    setLoading(true);
    setError(null);

    // ✅ w trybie multi (kraj/region/kolor) pobieramy większy zestaw i filtrujemy/paginujemy lokalnie
    const isMultiDifficulty = difficulty.length > 1;

    try {
      // 1) pobierz bazę danych (jedno lub wiele wywołań, jeśli wybrano wiele kolorów)
      let baseRows: ResortRow[] = [];

      if (!isMultiDifficulty) {
        const { data, error } = await supabase.rpc("resorts_public_list_search_v3", {
          p_q: q.trim().length ? q.trim() : null,
          p_status: "all",
          p_difficulty: difficulty.length === 1 ? difficulty[0] : null,
          p_kids_tape: kidsTapeOnly ? true : null,
          p_sort: sortKey,

          // multi kraj/region robimy lokalnie
          p_region: null,
          p_country: null,
          // minOpenKm w DB ma sens tylko gdy difficulty nie jest multi
          p_min_open_km: minOpenKm > 0 ? minOpenKm : null,

          // bierzemy więcej, bo paginujemy lokalnie (szczególnie gdy dochodzą filtry multi)
          p_limit: 2000,
          p_offset: 0,
        });

        if (error) throw error;
        baseRows = ((data ?? []) as any) as ResortRow[];
      } else {
        // ✅ wiele kolorów: pobieramy per kolor i sumujemy statystyki (open_km / total_km / slopes)
        const diffs = difficulty;
        const calls = await Promise.all(
          diffs.map((d) =>
            supabase.rpc("resorts_public_list_search_v3", {
              p_q: q.trim().length ? q.trim() : null,
              p_status: "all",
              p_difficulty: d,
              p_kids_tape: kidsTapeOnly ? true : null,
              p_sort: "open_km_desc",
              p_region: null,
              p_country: null,
              // minOpenKm zastosujemy dopiero po zsumowaniu
              p_min_open_km: null,
              p_limit: 2000,
              p_offset: 0,
            })
          )
        );

        for (const res of calls) {
          if (res.error) throw res.error;
        }

        // merge po id
        const merged = new Map<string, ResortRow>();

        for (const res of calls) {
          const list = ((res.data ?? []) as any) as ResortRow[];
          for (const r of list) {
            const key = String(r.id);
            const prev = merged.get(key);
            if (!prev) {
              merged.set(key, { ...r });
              continue;
            }

            // sumujemy tylko pola zależne od trudności
            const next: ResortRow = { ...prev };
            next.slopes_open = n0(prev.slopes_open) + n0(r.slopes_open);
            next.slopes_total = n0(prev.slopes_total) + n0(r.slopes_total);
            next.open_km = round1(n0(prev.open_km) + n0(r.open_km));
            next.total_km = round1(n0(prev.total_km) + n0(r.total_km));

            // resort_updated_at: bierz najnowsze
            const tNew = r.resort_updated_at ? new Date(r.resort_updated_at).getTime() : 0;
            const tPrev = prev.resort_updated_at ? new Date(prev.resort_updated_at).getTime() : 0;
            if (tNew > tPrev) next.resort_updated_at = r.resort_updated_at;

            merged.set(key, next);
          }
        }

        baseRows = Array.from(merged.values());
      }

      // 2) dedupe po id (na wypadek duplikatów z RPC)
      const byId = new Map<string, ResortRow>();
      for (const r of baseRows) {
        const key = String(r.id);
        const prev = byId.get(key);

        const tNew = r.resort_updated_at ? new Date(r.resort_updated_at).getTime() : 0;
        const tPrev = prev?.resort_updated_at ? new Date(prev.resort_updated_at).getTime() : 0;

        if (!prev || tNew > tPrev) byId.set(key, r);
      }
      let filtered = Array.from(byId.values());

      // 3) filtry multi: kraj -> region -> (kolor mamy już w danych) -> dzieci (już w DB) -> min km
      if (countryFilter.length) {
        const set = new Set(countryFilter.map((x) => normKey(x)));
        filtered = filtered.filter((r) => set.has(normKey((r.country ?? "").trim())));
      }

      if (regionFilter.length) {
        const set = new Set(regionFilter.map((x) => normKey(x)));
        filtered = filtered.filter((r) => set.has(normKey((r.region ?? "").trim())));
      }

      if (minOpenKm > 0) {
        filtered = filtered.filter((r) => n0(r.open_km) >= minOpenKm);
      }

      // 4) sort lokalny (pewniejszy w multi)
      const sorted = [...filtered].sort((a, b) => {
        if (sortKey === "open_km_desc") return n0(b.open_km) - n0(a.open_km);
        if (sortKey === "pph_desc") return n0(b.lifts_capacity_open_pph) - n0(a.lifts_capacity_open_pph);
        if (sortKey === "updated_desc") return tsMs(b.resort_updated_at) - tsMs(a.resort_updated_at);
        if (sortKey === "price_asc") {
          const ap = n0(a.skipass_price);
          const bp = n0(b.skipass_price);
          // 0/NULL ceny na koniec
          if (!ap && !bp) return 0;
          if (!ap) return 1;
          if (!bp) return -1;
          return ap - bp;
        }
        // comfort_desc
        const aComfort = n0(a.open_km) > 0 ? n0(a.lifts_capacity_open_pph) / n0(a.open_km) : 0;
        const bComfort = n0(b.open_km) > 0 ? n0(b.lifts_capacity_open_pph) / n0(b.open_km) : 0;
        return bComfort - aComfort;
      });

      // 5) tiles zgodne z filtrem
      const openCount = sorted.filter((r) => normalizeResortStatus(r.status_norm) === "open").length;
      const closedCount = sorted.length - openCount;
      setTiles({ open: openCount, closed: closedCount });

      // ✅ baza dla opcji filtrów (pełna lista po filtrach)
      setFilterBaseRows(sorted);

      // 6) paginacja
      const tc = sorted.length;
      setTotalCount(tc);

      const offset = (page - 1) * PAGE_SIZE;
      const paged = sorted.slice(offset, offset + PAGE_SIZE);

      setRows(paged);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Błąd wczytywania");
      setRows([]);
      setFilterBaseRows([]);
      setTotalCount(0);
      setTiles({ open: 0, closed: 0 });
      setFilterBaseRows([]);
      setLoading(false);
    }
  }

  useEffect(() => setPage(1), [q, difficulty, kidsTapeOnly, sortKey, minOpenKm, regionFilter, countryFilter]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, difficulty, kidsTapeOnly, sortKey, minOpenKm, regionFilter, countryFilter]);

  useEffect(() => {
    loadGlobalStatsUpdatedAt();
  }, []);

  const resortUpdateTs = (r: ResortRow) => r.resort_updated_at ?? null;

  // ✅ NIE FILTRUJEMY LOKALNIE – DB daje już wyniki globalne
  const visibleRows = useMemo(() => {
    let out = rows;

    // jeśli chcesz mimo wszystko mieć "updated_desc" wymuszone po stronie – zostawiamy:
    if (sortKey === "updated_desc") {
      out = [...out].sort((a, b) => tsMs(resortUpdateTs(b)) - tsMs(resortUpdateTs(a)));
    }

    return out;
  }, [rows, sortKey]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", fontFamily: "system-ui, Arial" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
        <ContentBanner globalStatsUpdatedAt={globalStatsUpdatedAt} />
      </div>

      <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
        <div className="tilesGrid">
          <Tile title="Otwarte" value={tiles.open} />
          <Tile title="Zamknięte" value={tiles.closed} />
        </div>

        {/* ===================== TOP BAR ===================== */}
        <div className="topBar">
          <div className="topBarLeft">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Szukaj (np. Białka, Szczyrk, Małopolska, Polska)…"
              style={{ ...inputStyle, height: 44 }}
            />

            <button type="button" onClick={openFilters} style={pillBtnStyle(false)} aria-label="Filtry">
              Filtry
              {activeFiltersCount > 0 ? <span style={badgeStyle}>{activeFiltersCount}</span> : null}
            </button>
          </div>

          <div className="topBarRight">
            <label style={{ fontSize: 12, color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" }}>Sortuj</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{ ...selectStyle, height: 44, width: 220 }}
              aria-label="Sortowanie"
            >
              <option value="open_km_desc">Otwarte km ↓</option>
              <option value="comfort_desc">Komfort (PPH / km) ↓</option>
              <option value="pph_desc">Przepustowość (PPH) ↓</option>
              <option value="updated_desc">Aktualizacja ↓</option>
              <option value="price_asc">Cena skipassa ↑</option>
            </select>
          </div>
        </div>

        {/* ===================== INFO ROW ===================== */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            Wyniki: <b style={{ color: "#0f172a" }}>{totalCount}</b> • Strona <b style={{ color: "#0f172a" }}>{page}</b> /{" "}
            <b style={{ color: "#0f172a" }}>{totalPages}</b>
            <span style={{ marginLeft: 8, color: "#94a3b8" }}>
              (sort: {sortLabel(sortKey)}
              {difficulty.length ? ` • ${difficultySetLabel(difficulty)}` : ""})
            </span>
            {kidsTapeOnly ? <span style={{ marginLeft: 8, color: "#94a3b8" }}>• taśma dla dzieci</span> : null}
            {minOpenKm > 0 ? <span style={{ marginLeft: 8, color: "#94a3b8" }}>• open_km &gt; {minOpenKm}</span> : null}
            {regionFilter.length ? <span style={{ marginLeft: 8, color: "#94a3b8" }}>• region: {regionFilter.join(", ")}</span> : null}
            {countryFilter.length ? <span style={{ marginLeft: 8, color: "#94a3b8" }}>• kraj: {countryFilter.join(", ")}</span> : null}
          </div>
          {loading && <span style={{ color: "#475569", fontSize: 12 }}>Ładowanie…</span>}
          {error && <span style={{ color: "#dc2626", fontSize: 12 }}>Błąd: {error}</span>}
        </div>

        {/* ===================== CARDS (mobile + force) ===================== */}
        <div className={forceCards ? "forceShow" : forceTable ? "hide" : "mobileOnly"}>
          <ResortCards rows={visibleRows} loading={loading} onOpenResort={(r) => router.push(resortPath(r))} resortUpdateTs={resortUpdateTs} />
        </div>

        {/* ===================== TABLE (desktop + force) ===================== */}
        <div className={forceTable ? "forceShowTable" : forceCards ? "hide" : "desktopOnly"}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead style={{ background: "#fafcff" }}>
                  <tr>
                    <Th style={{ width: 210 }}>Resort</Th>
                    <Th style={{ width: 95 }}>Status</Th>
                    <Th style={{ width: 85 }}>Trasy</Th>
                    <Th style={{ width: 95 }}>Otwarte km</Th>
                    <Th style={{ width: 140 }}>Skipass</Th>
                    <Th style={{ width: 90 }}>Wyciągi</Th>
                    <Th style={{ width: 130 }}>Przepustowość</Th>
                    <Th style={{ width: 150 }}>Aktualizacja</Th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, color: "#64748b", fontSize: 13 }}>
                        Brak wyników dla wybranych filtrów.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((r, idx) => {
                      const s = normalizeResortStatus(r.status_norm);

                      const openKm = n0(r.open_km);
                      const slopesOpen = n0(r.slopes_open);
                      const slopesTotal = n0(r.slopes_total);

                      const liftsOpen = n0(r.lifts_open);
                      const liftsTotal = n0(r.lifts_total);

                      const pphOpen = n0(r.lifts_capacity_open_pph);

                      const hasPrice = r.skipass_price !== null && Number.isFinite(Number(r.skipass_price));
                      const price = Number(r.skipass_price ?? 0);
                      const cur = (r.skipass_currency ?? "PLN").toUpperCase();

                      const sublineParts = [r.city, r.region, r.country].filter((x) => !!(x && String(x).trim().length > 0)) as string[];
                      const subline = sublineParts.length > 0 ? sublineParts.join(" • ") : null;

                      const upd = resortUpdateTs(r);

                      return (
                        <tr
                          key={(r.id as any) ?? idx}
                          className="rowLink"
                          onClick={() => router.push(resortPath(r))}
                          role="link"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") router.push(resortPath(r));
                          }}
                        >
                          <Td style={{ whiteSpace: "normal" }}>
                            <div style={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>{r.name ?? "—"}</div>
                            {subline ? (
                              <div
                                style={{
                                  color: "#94a3b8",
                                  fontSize: 12,
                                  marginTop: 2,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={subline}
                              >
                                {subline}
                              </div>
                            ) : null}
                          </Td>

                          <Td>
                            <span style={statusPillStyle(s)}>
                              <span style={dotStyle(s)} />
                              {statusLabel(s)}
                            </span>
                          </Td>

                          <Td style={{ textAlign: "left" }}>{`${slopesOpen} / ${slopesTotal}`}</Td>
                          <Td style={{ textAlign: "left" }}>{`${round1(openKm)} km`}</Td>

                          <Td style={{ textAlign: "left" }}>
                            {hasPrice ? (
                              <>
                                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{fmtMoney(price, cur)}</span>
                                {r.skipass_label ? (
                                  <div
                                    style={{
                                      marginTop: 2,
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      lineHeight: 1.2,
                                    }}
                                    title={r.skipass_label}
                                  >
                                    {r.skipass_label}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>—</span>
                            )}
                          </Td>

                          <Td style={{ textAlign: "left" }}>{`${liftsOpen} / ${liftsTotal}`}</Td>

                          <Td style={{ textAlign: "left" }}>{pphOpen > 0 ? fmtPPH(pphOpen) : <span style={{ color: "#94a3b8" }}>—</span>}</Td>

                          <Td style={{ textAlign: "left" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                              <span title={upd ? fmtDate(upd) : "Brak aktualizacji"}>{upd ? fmtDateShort(upd) : "—"}</span>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(resortPath(r));
                                }}
                                style={ctaLinkBtnStyle}
                                aria-label={`Zobacz ${r.name ?? "resort"}`}
                              >
                                Zobacz →
                              </button>
                            </div>
                          </Td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderTop: "1px solid #e2e8f0", background: "#ffffff", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} style={pagerBtnStyle(page <= 1 || loading)}>
                ← Poprzednia
              </button>

              <div style={{ color: "#64748b", fontSize: 12 }}>
                {totalCount === 0 ? "0" : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} z {totalCount}
              </div>

              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} style={pagerBtnStyle(page >= totalPages || loading)}>
                Następna →
              </button>
            </div>
          </div>
        </div>

        {/* ✅ paginacja pod kartami (mobile) */}
        <div className={forceCards ? "forceShow" : forceTable ? "hide" : "mobileOnly"} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} style={pagerBtnStyle(page <= 1 || loading)}>
              ← Poprzednia
            </button>

            <div style={{ color: "#64748b", fontSize: 12 }}>
              {totalCount === 0 ? "0" : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} z {totalCount}
            </div>

            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} style={pagerBtnStyle(page >= totalPages || loading)}>
              Następna →
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px dashed #e2e8f0", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
          Dane prezentowane na stronie pochodzą bezpośrednio od ośrodków narciarskich, z kamer online oraz z wizji lokalnych. Informacje są aktualizowane codziennie i mogą różnić się od stanu faktycznego w danym momencie. W razie znalezienia błędów lub braków resortów proszę o kontakt :{" "}
          <a href="mailto:kontakt@otwartestoki.pl" style={{ color: "#2563eb", fontWeight: 800, textDecoration: "none" }}>
            kontakt@otwartestoki.pl
          </a>
        </div>

        {/* ===================== FILTER SHEET ===================== */}
        <BottomSheet
          open={filtersOpen}
          title="Filtry"
          onClose={() => setFiltersOpen(false)}
          footer={
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={resetDraft}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontWeight: 900,
                }}
              >
                Wyczyść
              </button>
              <button
                type="button"
                onClick={applyFilters}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 14,
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#ffffff",
                  fontWeight: 900,
                }}
              >
                Zastosuj
              </button>
            </div>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            {/* ✅ hierarchia: kraj -> region -> kolor -> dzieci -> min km */}

            <div>
              <div style={labelStyle}>Kraj</div>
              <FilterChipsMulti
                value={dCountry}
                onChange={(v) => {
                  setDCountry(v);
                  // ✅ po zmianie kraju usuń regiony, które nie występują w wybranych krajach
                  if (!v.length) {
                    // jeśli wracamy do 'wszystkie kraje', zostaw regiony bez zmian
                    return;
                  }
                  const allowed = new Set(
                    filterBaseRows
                      .filter((r) => v.some((c) => normKey(c) === normKey(r.country)))
                      .map((r) => (r.region ?? "").trim())
                      .filter((x) => x)
                      .map((x) => normKey(x))
                  );
                  setDRegion((prev) => prev.filter((rg) => allowed.has(normKey(rg))));
                }}
                allLabel="Wszystkie"
                options={countryOptions.map((x) => ({ value: x, label: x }))}
              />
            </div>

            <div>
              <div style={labelStyle}>Region</div>
              <FilterChipsMulti
                value={dRegion}
                onChange={(v) => setDRegion(v)}
                allLabel="Wszystkie"
                options={regionOptions
                  .filter((rg) => {
                    if (!dCountry.length) return true;
                    // pokaż regiony tylko z wybranych krajów
                    const allowed = new Set(
                      filterBaseRows
                        .filter((r) => dCountry.some((c) => normKey(c) === normKey(r.country)))
                        .map((r) => (r.region ?? "").trim())
                        .filter((x) => x)
                        .map((x) => normKey(x))
                    );
                    return allowed.has(normKey(rg));
                  })
                  .map((x) => ({ value: x, label: x }))}
              />
            </div>

            <div>
              <div style={labelStyle}>Kolor / trudność tras</div>
              <FilterChipsMulti
                value={dDifficulty}
                onChange={(v) => setDDifficulty(v as any)}
                allLabel="Wszystkie"
                getChipStyle={(active, optionValue) => {
                  if (optionValue === "all") return chipBtnStyle(active);
                  const c = difficultyColor(optionValue as DifficultyOption);
                  return chipBtnStyleColored(active, c);
                }}
                options={[
                  { value: "green", label: "Zielone" },
                  { value: "blue", label: "Niebieskie" },
                  { value: "red", label: "Czerwone" },
                  { value: "black", label: "Czarne" },
                ]}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>
                {dDifficulty.length ? `Trasy + km dla: ${difficultySetLabel(dDifficulty as any)}` : "Trasy + km dla wszystkich tras."}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Dzieci</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button type="button" onClick={() => setDKidsTapeOnly((v) => !v)} style={chipBtnStyle(dKidsTapeOnly)} aria-pressed={dKidsTapeOnly}>
                  Taśma dla dzieci 👶 {dKidsTapeOnly ? "✓" : ""}
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>Pokaż tylko resorty z otwartą taśmą dla dzieci.</div>
            </div>

            <div>
              <div style={labelStyle}>Min. otwarte km</div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{Number.isFinite(dMinOpenKm) ? dMinOpenKm : 0} km</div>
                  <button type="button" onClick={() => setDMinOpenKm(0)} disabled={dMinOpenKm <= 0} style={btnStyle(dMinOpenKm <= 0)}>
                    Reset
                  </button>
                </div>

                <input
                  type="range"
                  min={0}
                  max={maxOpenKmForSlider}
                  step={0.1}
                  value={Number.isFinite(dMinOpenKm) ? dMinOpenKm : 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDMinOpenKm(Number.isFinite(v) ? Math.max(0, v) : 0);
                  }}
                  style={{ width: "100%" }}
                  aria-label="Min. otwarte km"
                />

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8" }}>
                  <span>0</span>
                  <span>{maxOpenKmForSlider} km</span>
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>Zakres suwaka jest celowo krótki (0–3 km) dla wygody na mobile.</div>
            </div>
          </div>

        </BottomSheet>

        <style jsx>{`
          .tilesGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-top: 14px;
            margin-bottom: 14px;
          }

          .desktopOnly {
            display: block;
          }
          .mobileOnly {
            display: none;
          }
          .hide {
            display: none;
          }

          .forceShow {
            display: block;
          }
          .forceShowTable {
            display: block;
          }

          .topBar {
            position: sticky;
            top: 0;
            z-index: 30;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(10px);
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 12px;
            margin-bottom: 12px;

            display: flex;
            gap: 12px;
            align-items: center;
            justify-content: space-between;
          }

          .topBarLeft {
            display: flex;
            gap: 10px;
            align-items: center;
            flex: 1;
            min-width: 0;
          }

          .topBarLeft :global(input) {
            flex: 1;
            min-width: 0;
          }

          .topBarRight {
            display: flex;
            gap: 8px;
            align-items: center;
            justify-content: flex-end;
            white-space: nowrap;
          }

          :global(tr.rowLink) {
            cursor: pointer;
            transition: background 120ms ease;
          }
          :global(tr.rowLink:hover) {
            background: #f8fafc;
          }
          :global(tr.rowLink:focus-visible) {
            outline: 2px solid #0f172a;
            outline-offset: -2px;
          }

          @media (max-width: 820px) {
            .tilesGrid {
              grid-template-columns: 1fr;
            }

            .desktopOnly {
              display: none;
            }
            .mobileOnly {
              display: block;
            }

            .topBar {
              flex-direction: column;
              align-items: stretch;
            }

            .topBarRight {
              justify-content: space-between;
            }

            .topBarRight :global(select) {
              width: 100% !important;
            }
          }
        `}</style>
      </main>
    </div>
  );
}

/* ===================== BANNER ===================== */

function ContentBanner({ globalStatsUpdatedAt }: { globalStatsUpdatedAt: string | null }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", background: "#fafcff" }}>
      <div style={{ width: "100%", aspectRatio: "1470 / 300", background: "#fafcff" }}>
        <img src="/baner.png" alt="otwartestoki banner" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 12px", background: "#ffffff", borderTop: "1px solid #e2e8f0", color: "#64748b", fontSize: 12 }}>
        Ostatnia aktualizacja: <b style={{ color: "#0f172a" }}>{fmtDate(globalStatsUpdatedAt)}</b>
      </div>
    </div>
  );
}

/* ===================== BOTTOM SHEET ===================== */

function BottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div className="bsOverlay" style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }} onClick={onClose} />

      <div className="bsPanel" style={{ transform: open ? "translateY(0)" : "translateY(110%)" }} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 950, color: "#0f172a" }}>{title}</div>
          <button type="button" onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "#ffffff", borderRadius: 12, height: 36, padding: "0 12px", fontWeight: 900, color: "#0f172a" }}>
            Zamknij
          </button>
        </div>

        <div style={{ padding: 14, overflowY: "auto", maxHeight: "calc(85vh - 70px - 76px)" }}>{children}</div>

        <div style={{ padding: 14, borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>{footer}</div>
      </div>

      <style jsx>{`
        .bsOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          transition: opacity 180ms ease;
          z-index: 80;
        }
        .bsPanel {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 90;
          background: #ffffff;
          border-top-left-radius: 18px;
          border-top-right-radius: 18px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 -10px 30px rgba(15, 23, 42, 0.18);
          transition: transform 220ms ease;
          max-height: 85vh;
        }
      `}</style>
    </>
  );
}

/* ===================== MOBILE CARDS ===================== */

function ResortCards({
  rows,
  loading,
  onOpenResort,
  resortUpdateTs,
}: {
  rows: ResortRow[];
  loading: boolean;
  onOpenResort: (r: ResortRow) => void;
  resortUpdateTs: (r: ResortRow) => string | null;
}) {
  if (rows.length === 0 && !loading) {
    return <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", padding: 14, color: "#64748b" }}>Brak wyników dla wybranych filtrów.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r, idx) => {
        const s = normalizeResortStatus(r.status_norm);

        const openKm = n0(r.open_km);
        const totalKm = n0(r.total_km);

        const slopesOpen = n0(r.slopes_open);
        const slopesTotal = n0(r.slopes_total);

        const liftsOpen = n0(r.lifts_open);
        const liftsTotal = n0(r.lifts_total);

        const pphOpen = n0(r.lifts_capacity_open_pph);

        const hasPrice = r.skipass_price !== null && Number.isFinite(Number(r.skipass_price));
        const price = Number(r.skipass_price ?? 0);
        const cur = (r.skipass_currency ?? "PLN").toUpperCase();

        const sublineParts = [r.city, r.region, r.country].filter((x) => !!(x && String(x).trim().length > 0)) as string[];
        const subline = sublineParts.length > 0 ? sublineParts.join(" • ") : null;

        const upd = resortUpdateTs(r);

        return (
          <div
            key={(r.id as any) ?? idx}
            className="card"
            onClick={() => onOpenResort(r)}
            role="link"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpenResort(r);
            }}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              background: "#ffffff",
              padding: 12,
              boxShadow: "0 1px 0 rgba(15,23,42,0.04)",
              cursor: "pointer",
              width: "100%",
              maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 950, color: "#0f172a", lineHeight: 1.15 }}>{r.name ?? "—"}</div>
                {subline ? (
                  <div style={{ marginTop: 2, color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }} title={subline}>
                    {subline}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={statusPillStyle(s)}>
                  <span style={dotStyle(s)} />
                  {statusLabel(s)}
                </span>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 800, textAlign: "right" }}>Dotknij, aby otworzyć</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <MiniStat label="Otwarte km" value={`${round1(openKm)} km`} sub={totalKm > 0 ? `z ${round1(totalKm)} km` : undefined} />
              <MiniStat label="Trasy" value={`${slopesOpen} / ${slopesTotal}`} />
              <MiniStat label="Wyciągi" value={`${liftsOpen} / ${liftsTotal}`} />
              <MiniStat label="Przepustowość" value={pphOpen > 0 ? fmtPPH(pphOpen) : "—"} />
            </div>

            <div className="cardBottomRow">
              <div className="skipassBlock">
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Skipass</div>

                {hasPrice ? <span style={{ fontWeight: 800, color: "#0f172a" }}>{fmtMoney(price, cur)}</span> : <span style={{ color: "#94a3b8" }}>—</span>}

                {shortSkipassLabel(r.skipass_label) ? (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      color: "#94a3b8",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                    title={r.skipass_label ?? undefined}
                  >
                    {shortSkipassLabel(r.skipass_label)}
                  </div>
                ) : null}
              </div>

              <div className="updateBlock">
                <div className="updateLabel">Aktualizacja</div>

                <div className="updateRow">
                  <div className="updateDate" title={upd ? fmtDate(upd) : "Brak aktualizacji"}>
                    {upd ? fmtDateShort(upd) : "—"}
                  </div>

                  {/* ✅ JEDYNY CTA na mobile */}
                  <button
                    type="button"
                    className="updateBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenResort(r);
                    }}
                    style={ctaMobileStyle}
                    aria-label={`Szczegóły: ${r.name ?? "resort"}`}
                  >
                    Szczegóły →
                  </button>
                </div>
              </div>
            </div>

            <style jsx>{`
              .card {
                transition: transform 90ms ease, box-shadow 120ms ease;
              }
              .card:active {
                transform: scale(0.99);
              }

              .cardBottomRow {
                display: flex;
                justify-content: space-between;
                gap: 10px;
                margin-top: 10px;
                align-items: flex-end;
                max-width: 100%;
              }

              .skipassBlock {
                flex: 1;
                min-width: 0; /* ✅ kluczowe dla ellipsis */
              }

              .updateBlock {
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 4px;

                min-width: 0;
                max-width: 52%;
              }

              .updateLabel {
                font-size: 11px;
                color: #94a3b8;
              }

              .updateRow {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: nowrap;
                min-width: 0;
                max-width: 100%;
              }

              .updateDate {
                font-size: 12px;
                color: #0f172a;
                font-weight: 800;
                white-space: nowrap;
              }

              .updateBtn {
                flex-shrink: 0;
              }

              @media (max-width: 380px) {
                .cardBottomRow {
                  flex-direction: column;
                  align-items: stretch;
                }

                .updateBlock {
                  align-items: flex-start;
                  max-width: 100%;
                  width: 100%;
                }

                .updateRow {
                  width: 100%;
                  justify-content: space-between;
                }
              }
            `}</style>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #f1f5f9", borderRadius: 14, padding: 10, background: "#fbfdff", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
    </div>
  );
}

/* ===================== UI ===================== */


function FilterChipsMulti({
  value,
  onChange,
  options,
  allLabel = "Wszystkie",
  getChipStyle,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  getChipStyle?: (active: boolean, optionValue: string) => React.CSSProperties;
}) {
  const many = options.length >= 12;

  function isActive(v: string) {
    return value.some((x) => normKey(x) === normKey(v));
  }

  function toggle(v: string) {
    const active = isActive(v);
    if (active) {
      onChange(value.filter((x) => normKey(x) !== normKey(v)));
    } else {
      onChange([...value, v]);
    }
  }

  const allActive = value.length === 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "stretch",
        maxHeight: many ? 220 : undefined,
        overflowY: many ? "auto" : undefined,
        paddingRight: many ? 4 : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onChange([])}
        style={getChipStyle ? getChipStyle(allActive, "all") : chipBtnStyle(allActive)}
        aria-pressed={allActive}
      >
        {allLabel} {allActive ? "✓" : ""}
      </button>

      {options.map((o) => {
        const active = isActive(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            style={getChipStyle ? getChipStyle(active, o.value) : chipBtnStyle(active)}
            aria-pressed={active}
            title={o.label}
          >
            {o.label} {active ? "✓" : ""}
          </button>
        );
      })}
    </div>
  );
}

function Tile({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#ffffff" }}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 850, lineHeight: 1.1, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function Th({ children, style }: { children: any; style?: any }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "6px 8px",
        fontSize: 12,
        color: "#64748b",
        fontWeight: 700,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

type TdProps = React.TdHTMLAttributes<HTMLTableCellElement>;

function Td({ children, style, ...props }: TdProps) {
  return (
    <td
      {...props}
      style={{
        padding: "6px 8px",
        verticalAlign: "top",
        fontSize: 13,
        color: "#0f172a",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

/* ===================== shared styles ===================== */

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  outline: "none",
  background: "#fbfdff",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#fbfdff",
  color: "#0f172a",      // 🔥
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#0f172a", // 🔥 slate-900
  fontWeight: 800,
  marginBottom: 6,
};

function pagerBtnStyle(disabled: boolean) {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#ffffff",
    color: disabled ? "#94a3b8" : "#0f172a",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    fontSize: 13,
  } as const;
}

function btnStyle(disabled: boolean) {
  return {
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#ffffff",
    color: disabled ? "#94a3b8" : "#0f172a",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: "nowrap",
  } as const;
}


// ✅ kafelki / chips w filtrach (mobile-first)
function chipBtnStyle(active: boolean) {
  return {
    height: 44,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#ffffff" : "#0f172a",
    fontWeight: 950,
    padding: "0 12px",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as const;
}

// ✅ kafelki z ramką w kolorze (np. trudność tras)
function chipBtnStyleColored(active: boolean, color: string) {
  return {
    ...chipBtnStyle(active),
    border: `1px solid ${color}`,
    background: active ? color : "#ffffff",
    color: active ? "#ffffff" : "#0f172a",
  } as const;
}

function pillBtnStyle(active: boolean) {
  return {
    height: 44,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#ffffff" : "#0f172a",
    fontWeight: 950,
    padding: "0 12px",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  } as const;
}

const badgeStyle: React.CSSProperties = {
  minWidth: 22,
  height: 22,
  borderRadius: 999,
  background: "#0f172a",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 900,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 6px",
};

const ctaLinkBtnStyle: React.CSSProperties = {
  border: "1px solid transparent",
  background: "transparent",
  padding: "4px 6px",
  borderRadius: 10,
  color: "#2563eb",
  fontWeight: 900,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  lineHeight: 1,
};

const ctaMobileStyle: React.CSSProperties = {
  border: "1px solid #0f172a",
  background: "#0f172a",
  padding: "8px 10px",
  borderRadius: 999,
  color: "#ffffff",
  fontWeight: 900,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  lineHeight: 1,
};
