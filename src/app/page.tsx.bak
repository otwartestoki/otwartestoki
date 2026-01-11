"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

/* ===================== TYPES ===================== */

type ResortRow = {
  id: number | string;
  name: string | null;
  region: string | null;
  city: string | null;

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

  // ✅ przepustowość (otwarta) na godzinę
  lifts_capacity_open_pph: number | null;

  // ✅ te pola pochodzą bezpośrednio z RPC (które czyta widok resorts_public_list)
  skipass_price: number | null;
  skipass_currency: string | null;
  skipass_url: string | null;

  // (opcjonalnie) opis skipassa pod ceną – jeśli RPC go kiedyś doda
  skipass_label: string | null;

  stats_updated_at: string | null;

  // ✅ z RPC
  has_open_kids_tape?: boolean | null;

  // ✅ zwracane przez RPC
  total_count?: number | null;
};

type DifficultyFilter = "all" | "green" | "blue" | "red" | "black";

/* ✅ sortowanie (SQL) */
type SortKey = "open_km_desc" | "comfort_desc" | "pph_desc" | "updated_desc" | "price_asc";

/* ===================== CONST ===================== */

const PAGE_SIZE = 15;

/* ===================== HELPERS ===================== */

function normalizeResortStatus(s?: string | null) {
  const v = (s ?? "").toLowerCase().trim();
  if (["open", "otwarty", "otwarta", "otwarte", "opened"].includes(v)) return "open";
  if (["closed", "zamkniety", "zamknięty", "zamknieta", "zamknięta", "zamkniete", "zamknięte"].includes(v))
    return "closed";
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
  return dt.toLocaleString("pl-PL");
}

/* ✅ krótki format do kolumny tabeli */
function fmtDateShort(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString("pl-PL", {
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
  if (cur === "PLN") {
    return x.toLocaleString("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });
  }
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

function difficultyLabel(filter: DifficultyFilter) {
  if (filter === "all") return "Wszystkie";
  if (filter === "green") return "Zielone / łatwe";
  if (filter === "blue") return "Niebieskie / średnie";
  if (filter === "red") return "Czerwone / trudne";
  return "Czarne / bardzo trudne";
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
      return "Najnowsza aktualizacja ↓";
    case "price_asc":
      return "Cena skipassa ↑";
    default:
      return "Otwarte km ↓";
  }
}

/* ✅ slug do URL (slug--id) */
function slugifyPL(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function resortSlug(r: { name?: string | null; city?: string | null; region?: string | null }) {
  const parts = [r.name, r.city, r.region].filter((x) => x && String(x).trim().length) as string[];
  const base = parts.join(" ");
  const slug = slugifyPL(base);
  return slug.length ? slug : "resort";
}

/* ===================== COMPONENT ===================== */

export default function Home() {
  const [rows, setRows] = useState<ResortRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [globalStatsUpdatedAt, setGlobalStatsUpdatedAt] = useState<string | null>(null);

  // ✅ kafelki globalne (dla wszystkich resortów spełniających filtry)
  const [tiles, setTiles] = useState<{ open: number; closed: number }>({ open: 0, closed: 0 });

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "closed">("all");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");

  // ✅ filtr - tylko resorty z otwartą taśmą
  const [kidsTapeOnly, setKidsTapeOnly] = useState(false);

  // ✅ NOWY filtr: minimalna liczba otwartych km (po stronie klienta)
  // domyślnie 0 = brak filtrowania
  const [minOpenKm, setMinOpenKm] = useState<number>(0);

  // ✅ sortowanie (SQL)
  const [sortKey, setSortKey] = useState<SortKey>("open_km_desc");

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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

  // ✅ globalne liczniki otwarte/zamknięte (nie zależą od paginacji)
  async function loadTiles() {
    const { data, error } = await supabase.rpc("resorts_public_counts", {
      p_q: q.trim().length ? q.trim() : null,
      p_difficulty: difficulty,
      p_kids_tape: kidsTapeOnly ? true : null,
    });

    if (error) {
      console.warn("[loadTiles]", error);
      setTiles({ open: 0, closed: 0 });
      return;
    }

    const row = (data as any)?.[0] ?? {};
    setTiles({
      open: Number(row.open_count ?? 0) || 0,
      closed: Number(row.closed_count ?? 0) || 0,
    });
  }

  async function load() {
    setLoading(true);
    setError(null);

    const offset = (page - 1) * PAGE_SIZE;

    const { data, error } = await supabase.rpc("resorts_public_list_search", {
      p_q: q.trim().length ? q.trim() : null,
      p_status: status,
      p_difficulty: difficulty,
      p_kids_tape: kidsTapeOnly ? true : null,

      // ✅ sortowanie po stronie SQL
      p_sort: sortKey,

      p_limit: PAGE_SIZE,
      p_offset: offset,
    });

    if (error) {
      setError(error.message);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const list = ((data ?? []) as any) as ResortRow[];
    const tc = (data as any)?.[0]?.total_count ?? 0;
    setTotalCount(Number(tc) || 0);

    setRows(list);
    setLoading(false);
  }

  useEffect(() => setPage(1), [q, status, difficulty, kidsTapeOnly, sortKey, minOpenKm]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, status, difficulty, kidsTapeOnly, sortKey]);

  useEffect(() => {
    loadGlobalStatsUpdatedAt();
  }, []);

  // ✅ gdy zmienia się filtr globalny (q/difficulty/kidsTapeOnly) – odśwież kafelki
  useEffect(() => {
    loadTiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, difficulty, kidsTapeOnly]);

  // ✅ klient-side filtr po open_km (RPC jeszcze nie wspiera tego parametru)
  const filteredRows = useMemo(() => {
    const thr = Number.isFinite(minOpenKm) ? minOpenKm : 0;
    if (!thr || thr <= 0) return rows;
    return rows.filter((r) => n0(r.open_km) > thr);
  }, [rows, minOpenKm]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", fontFamily: "system-ui, Arial" }}>
      {/* ✅ banner aligned to content width */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
        <ContentBanner globalStatsUpdatedAt={globalStatsUpdatedAt} />
      </div>

      {/* PAGE CONTENT */}
      <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
            marginTop: 14,
            marginBottom: 14,
          }}
        >
          <Tile title="Otwarte" value={tiles.open} />
          <Tile title="Zamknięte" value={tiles.closed} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: 10,
            padding: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 14,
            marginBottom: 12,
            background: "#ffffff",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>Szukaj</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="np. Białka, Szczyrk, Małopolska…"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                outline: "none",
                background: "#fbfdff",
              }}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>Szuka po: nazwie, mieście i regionie.</div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 10,
                fontSize: 12,
                color: "#64748b",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={kidsTapeOnly}
                onChange={(e) => setKidsTapeOnly(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              Tylko z otwartą taśmą dla dzieci
            </label>

            {/* ✅ min open_km */}
            <div style={{ marginTop: 10 }}>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>
                Min. otwarte km (więcej niż)
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={Number.isFinite(minOpenKm) ? minOpenKm : 0}
                  onChange={(e) => {
                    const v = Number(String(e.target.value).replace(",", "."));
                    setMinOpenKm(Number.isFinite(v) ? Math.max(0, v) : 0);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    outline: "none",
                    background: "#fbfdff",
                  }}
                  placeholder="np. 10"
                />

                <button
                  type="button"
                  onClick={() => setMinOpenKm(0)}
                  disabled={minOpenKm <= 0}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    background: minOpenKm <= 0 ? "#f8fafc" : "#ffffff",
                    color: minOpenKm <= 0 ? "#94a3b8" : "#0f172a",
                    cursor: minOpenKm <= 0 ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                  title="Wyczyść filtr otwartych km"
                >
                  Reset
                </button>
              </div>

              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Filtr działa lokalnie (na wynikach z bieżącej strony) i pokazuje resorty, które mają{" "}
                <b style={{ color: "#64748b" }}>więcej</b> niż podana liczba km.
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "#fbfdff",
              }}
            >
              <option value="all">Wszystkie</option>
              <option value="open">Otwarte</option>
              <option value="closed">Zamknięte</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>
              Kolor / trudność
            </label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as any)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "#fbfdff",
              }}
            >
              <option value="all">Wszystkie</option>
              <option value="green">Zielone / łatwe</option>
              <option value="blue">Niebieskie / średnie</option>
              <option value="red">Czerwone / trudne</option>
              <option value="black">Czarne / bardzo trudne</option>
            </select>

            {difficulty !== "all" ? (
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Trasy + otwarte km liczone tylko dla:{" "}
                <b style={{ color: "#64748b" }}>{difficultyLabel(difficulty)}</b>
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Trasy + otwarte km liczone dla wszystkich tras.
              </div>
            )}

            {/* ✅ sortowanie (bez resetu trudności) */}
            <div style={{ marginTop: 10 }}>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 }}>Sortowanie</label>
              <select
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value as SortKey);
                  // ❌ NIE resetujemy difficulty
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#fbfdff",
                }}
              >
                <option value="open_km_desc">Otwarte km ↓</option>
                <option value="comfort_desc">Komfort (PPH / km) ↓</option>
                <option value="pph_desc">Przepustowość (PPH) ↓</option>
                <option value="updated_desc">Najnowsza aktualizacja ↓</option>
                <option value="price_asc">Cena skipassa ↑</option>
              </select>

              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Komfort = przepustowość otwarta / otwarte km (wyżej = zwykle mniej tłoczno).
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            Wyniki: <b style={{ color: "#0f172a" }}>{totalCount}</b> • Strona <b style={{ color: "#0f172a" }}>{page}</b>{" "}
            / <b style={{ color: "#0f172a" }}>{totalPages}</b>
            <span style={{ marginLeft: 8, color: "#94a3b8" }}>
              (sort: {sortLabel(sortKey)}
              {difficulty !== "all" ? ` • ${difficultyLabel(difficulty)}` : ""})
            </span>
            {kidsTapeOnly ? <span style={{ marginLeft: 8, color: "#94a3b8" }}>• taśma dla dzieci</span> : null}
            {minOpenKm > 0 ? (
              <span style={{ marginLeft: 8, color: "#94a3b8" }}>• open_km &gt; {minOpenKm}</span>
            ) : null}
          </div>
          {loading && <span style={{ color: "#475569", fontSize: 12 }}>Ładowanie…</span>}
          {error && <span style={{ color: "#dc2626", fontSize: 12 }}>Błąd: {error}</span>}
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead style={{ background: "#fafcff" }}>
                <tr>
                  <Th style={{ width: 190 }}>Resort</Th>
                  <Th style={{ width: 95 }}>Status</Th>
                  <Th style={{ width: 85 }}>Trasy</Th>
                  <Th style={{ width: 95 }}>Otwarte km</Th>
                  <Th style={{ width: 120 }}>Skipass</Th>
                  <Th style={{ width: 90 }}>Wyciągi</Th>
                  <Th style={{ width: 130 }}>Przepustowość</Th>
                  <Th style={{ width: 90 }}>Akt.</Th>
                  <Th style={{ width: 60 }}>Link</Th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 14, color: "#64748b", fontSize: 13 }}>
                      Brak wyników dla wybranych filtrów.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, idx) => {
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

                    const sublineParts = [r.city, r.region].filter((x) => !!(x && String(x).trim().length > 0)) as string[];
                    const subline = sublineParts.length > 0 ? sublineParts.join(" • ") : null;

                    return (
                      <tr key={(r.id as any) ?? idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <Td style={{ whiteSpace: "normal" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <div
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                minWidth: 0,
                              }}
                              title={r.name ?? "—"}
                            >
                              <Link
                                href={`/resort/${resortSlug(r)}--${r.id}`}
                                style={{ fontWeight: 800, color: "#0f172a", textDecoration: "none" }}
                              >
                                {r.name ?? "—"}
                              </Link>
                            </div>
                          </div>

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
                              {r.skipass_url ? (
                                <a
                                  href={r.skipass_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    color: "#0f172a",
                                    textDecoration: "underline",
                                    textUnderlineOffset: 3,
                                    fontWeight: 400,
                                    whiteSpace: "nowrap",
                                  }}
                                  title="Cennik skipassa"
                                >
                                  {fmtMoney(price, cur)}
                                </a>
                              ) : (
                                <span style={{ fontWeight: 400, whiteSpace: "nowrap" }}>{fmtMoney(price, cur)}</span>
                              )}

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

                        <Td style={{ textAlign: "left" }}>
                          {pphOpen > 0 ? (
                            <span style={{ fontWeight: 400, whiteSpace: "nowrap" }}>{fmtPPH(pphOpen)}</span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </Td>

                        <Td style={{ textAlign: "left" }} title={fmtDate(r.last_checked_at)}>
                          {fmtDateShort(r.last_checked_at)}
                        </Td>

                        <Td>
                          {r.url ? (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: "#0f172a",
                                textDecoration: "underline",
                                textUnderlineOffset: 3,
                                fontWeight: 650,
                              }}
                            >
                              strona
                            </a>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 12,
              borderTop: "1px solid #e2e8f0",
              background: "#ffffff",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              style={btnStyle(page <= 1 || loading)}
            >
              ← Poprzednia
            </button>

            <div style={{ color: "#64748b", fontSize: 12 }}>
              {totalCount === 0 ? "0" : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} z {totalCount}
              {minOpenKm > 0 ? (
                <span style={{ marginLeft: 8, color: "#94a3b8" }}>• po filtrze open_km: {filteredRows.length} na tej stronie</span>
              ) : null}
            </div>

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              style={btnStyle(page >= totalPages || loading)}
            >
              Następna →
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 12,
            borderTop: "1px dashed #e2e8f0",
            fontSize: 12,
            color: "#94a3b8",
            lineHeight: 1.5,
          }}
        >
          Dane prezentowane na stronie pochodzą bezpośrednio od ośrodków narciarskich, z kamer online oraz z wizji lokalnych.
          Informacje są aktualizowane codziennie i mogą różnić się od stanu faktycznego w danym momencie. W razie znalezienia błędów
          lub braków resortów proszę o kontakt :{" "}
          <a href="mailto:kontakt@otwartestoki.pl" style={{ color: "#2563eb", fontWeight: 800, textDecoration: "none" }}>
            kontakt@otwartestoki.pl
          </a>
        </div>
      </main>
    </div>
  );
}

/* ===================== BANNER (CONTENT WIDTH) ===================== */

function ContentBanner({ globalStatsUpdatedAt }: { globalStatsUpdatedAt: string | null }) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        overflow: "hidden",
        background: "#fafcff",
      }}
    >
      {/* ✅ zamiast SVG: obrazek z /public/baner.png */}
      <img
        src="/baner.png"
        alt="otwartestoki banner"
        width={1200}
        height={300}
        style={{
          display: "block",
          width: "100%",
          height: 200, // trzyma poprzednią wysokość wizualną
          objectFit: "cover",
          background: "#fafcff",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "10px 12px",
          background: "#ffffff",
          borderTop: "1px solid #e2e8f0",
          color: "#64748b",
          fontSize: 12,
        }}
      >
        Globalna aktualizacja (statystyki): <b style={{ color: "#0f172a" }}>{fmtDate(globalStatsUpdatedAt)}</b>
      </div>
    </div>
  );
}

/* ===================== UI ===================== */

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

/** ✅ ZMIANA: Td przyjmuje normalne propsy <td>, więc można używać m.in. title= */
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

function btnStyle(disabled: boolean) {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#ffffff",
    color: disabled ? "#94a3b8" : "#0f172a",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: 13,
  } as const;
}
