"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ===================== TYPES ===================== */

type ResortPublic = {
  id: string | number;
  name?: string | null;
  region?: string | null;
  city?: string | null;
  country?: string | null;

  // ✅ jedyna aktualizacja na stronie
  resort_updated_at?: string | null;

  resort_stats?: ResortStats | null;
};

type ResortBase = {
  id: string | number;
  url?: string | null;

  // ❗ bierzemy z tabeli resorts (bo view nie ma)
  trail_map_url?: string | null;
  webcam_url?: string | null;
};

type Resort = ResortPublic & ResortBase;

type ResortStats = {
  slopes_open: number | null;
  slopes_total: number | null;
  open_km: number | null;
  total_km: number | null;

  lifts_open: number | null;
  lifts_total: number | null;

  skipass_price: number | null;
  skipass_currency: string | null;
  skipass_url: string | null;
  skipass_label: string | null;

  // zostaje w danych, ale NIE pokazujemy jako aktualizację
  stats_updated_at: string | null;
};

type Slope = {
  id?: string | number;
  number?: string | number | null;
  resort?: string | number | null;
  sector?: string | null;
  name?: string | null;
  difficulty?: string | null;
  length_m?: number | null;

  snow?: string | null;
  light?: boolean | string | null;
  status?: string | null;
  updated_at?: string | null;
};

type Lift = {
  id?: string | number;
  resort?: string | number | null;
  number?: string | number | null;
  name?: string | null;
  type?: string | null;
  seats?: number | null;
  capacity_pph?: number | null;
  length_m?: number | null;
  status?: string | null;
  updated_at?: string | null;
};

type SkipassCoverageRow = {
  resort_id: string | null;
  skipass_product_id: string | null;
  coverage_type: string | null;
  notes: string | null;
  created_at: string | null;

  skipass_products?: SkipassProduct | SkipassProduct[] | null;
};

type SkipassProduct = {
  id: string;
  name: string | null;
  provider: string | null;
  pass_type: string | null;
  currency: string | null;
  notes: string | null;
  url: string | null;
  season_label: string | null;
  last_checked_at: string | null;
  created_at: string | null;
};

type SkipassPrice = {
  id: string;
  skipass_product_id: string;
  category: string | null;
  duration_value: number | null;
  duration_unit: string | null;
  price: number | null;
  price_type: string | null;
  day_type: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string | null;
  last_checked_at: string | null;
  created_at: string | null;
};

/* ===================== HELPERS (jak na głównej) ===================== */

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

function fmtMoney(x: number, currency: string) {
  const cur = (currency ?? "PLN").toUpperCase();
  if (cur === "PLN") {
    return x.toLocaleString("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 });
  }
  return `${x.toFixed(0)} ${cur}`;
}

function parseResortId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  const idPart = s0.includes("--") ? s0.split("--").pop()!.trim() : s0;
  return idPart.length ? idPart : null;
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

function mToKm(m?: number | null) {
  if (!m || typeof m !== "number" || Number.isNaN(m)) return 0;
  return m / 1000;
}

function fmtKm(km: number) {
  return (Math.round(km * 10) / 10).toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function hasLight(v?: boolean | string | null) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).toLowerCase().trim();
  return ["1", "true", "tak", "yes", "y", "on", "light", "oświetlenie", "oswietlenie"].includes(s);
}

function lightLabel(v?: boolean | string | null) {
  return hasLight(v) ? "💡" : "—";
}

function hasSnow(v?: string | null) {
  if (v === null || v === undefined) return false;
  const s = String(v).toLowerCase().trim();
  if (!s.length) return false;
  if (["0", "false", "nie", "no", "off", "brak", "none", "n"].includes(s)) return false;
  return ["1", "true", "tak", "yes", "y", "on", "snow", "nasniez", "naśnież", "arm"].some((k) => s.includes(k));
}

function snowLabel(v?: string | null) {
  return hasSnow(v) ? "❄️" : "—";
}

/* ===================== DIFFICULTY ===================== */

type NormDifficulty = "hard" | "difficult" | "medium" | "easy" | "unknown";

function normalizeDifficulty(x?: string | null): NormDifficulty {
  if (!x) return "unknown";
  const s = x.toLowerCase().trim();
  if (["black", "hard", "expert", "czarna"].includes(s)) return "hard";
  if (["red", "difficult", "trudna", "czerwona"].includes(s)) return "difficult";
  if (["blue", "medium", "średnia", "srednia", "niebieska"].includes(s)) return "medium";
  if (["green", "easy", "łatwa", "latwa", "zielona"].includes(s)) return "easy";
  return "unknown";
}

function difficultyLabel(d: NormDifficulty) {
  switch (d) {
    case "hard":
      return "Czarna";
    case "difficult":
      return "Czerwona";
    case "medium":
      return "Niebieska";
    case "easy":
      return "Zielona";
    default:
      return "—";
  }
}

function difficultyAccent(d: NormDifficulty) {
  switch (d) {
    case "hard":
      return { fg: "#0f172a", dot: "#0f172a" };
    case "difficult":
      return { fg: "#991b1b", dot: "#dc2626" };
    case "medium":
      return { fg: "#1e40af", dot: "#2563eb" };
    case "easy":
      return { fg: "#166534", dot: "#16a34a" };
    default:
      return { fg: "#475569", dot: "#94a3b8" };
  }
}

/* ===================== STATUS ===================== */

type NormStatus = "open" | "closed" | "unknown";

function normalizeStatus(x?: string | null): NormStatus {
  if (!x) return "unknown";
  const s = x.toLowerCase().trim();
  if (["open", "otwarta", "otwarte", "czynna", "1", "true", "tak"].includes(s)) return "open";
  if (["closed", "zamknięta", "zamknieta", "zamknięte", "zamkniete", "nieczynna", "0", "false", "nie"].includes(s))
    return "closed";
  return "unknown";
}

function statusLabel(s: NormStatus) {
  switch (s) {
    case "open":
      return "Otwarte";
    case "closed":
      return "Zamknięte";
    default:
      return "—";
  }
}

function statusAccent(s: NormStatus) {
  switch (s) {
    case "open":
      return { fg: "#166534", dot: "#22c55e" };
    case "closed":
      return { fg: "#991b1b", dot: "#ef4444" };
    default:
      return { fg: "#475569", dot: "#94a3b8" };
  }
}

/* ===================== MEDIA ===================== */

function useIsMobile(breakpointPx = 860) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [breakpointPx]);

  return isMobile;
}

/* ===================== SKIPASS HELPERS ===================== */

function durationPL(v?: number | null, unit?: string | null) {
  if (!v || !unit) return null;
  const u = String(unit).toLowerCase().trim();

  if (u.startsWith("day") || u === "d") return v === 1 ? "1 dzień" : `${v} dni`;
  if (u.startsWith("hour") || u === "h" || u === "hr") return v === 1 ? "1 godz." : `${v} godz.`;
  if (u.startsWith("min")) return `${v} min`;
  if (u.startsWith("week")) return v === 1 ? "1 tydz." : `${v} tyg.`;
  if (u.startsWith("month")) return v === 1 ? "1 mies." : `${v} mies.`;
  if (u.startsWith("season")) return "sezon";
  return `${v} ${unit}`;
}

function labelFromPrice(p?: SkipassPrice | null) {
  if (!p) return null;
  const dur = durationPL(p.duration_value, p.duration_unit);
  const cat = p.category ? String(p.category).trim() : "";
  const pieces = [cat, dur].filter((x) => x && String(x).trim().length);
  return pieces.length ? pieces.join(" • ") : null;
}

function isValidInRange(p: SkipassPrice, at: Date) {
  const from = p.valid_from ? new Date(p.valid_from) : null;
  const to = p.valid_to ? new Date(p.valid_to) : null;

  const fromOk = !from || Number.isNaN(from.getTime()) ? true : at.getTime() >= from.getTime();
  const toOk = !to || Number.isNaN(to.getTime()) ? true : at.getTime() <= to.getTime();

  return fromOk && toOk;
}

/* ===================== PAGE ===================== */

export default function ResortPage() {
  const router = useRouter();
  const params = useParams<{ id?: string; slug?: string }>();

  const rawParam = (params?.id ?? params?.slug ?? "") as string;
  const resortId = useMemo(() => parseResortId(rawParam), [rawParam]);

  const isMobile = useIsMobile(860);

  const [resort, setResort] = useState<Resort | null>(null);
  const [slopes, setSlopes] = useState<Slope[]>([]);
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mapOpen, setMapOpen] = useState(false);

  const [slopesOpenUI, setSlopesOpenUI] = useState(false);
  const [liftsOpenUI, setLiftsOpenUI] = useState(false);
  const [skipassOpenUI, setSkipassOpenUI] = useState(false);

  const [skipassRows, setSkipassRows] = useState<
    Array<{
      product: SkipassProduct;
      bestPrice: SkipassPrice | null;
      label: string | null;
      price: number | null;
      currency: string | null;
      url: string | null;
    }>
  >([]);

  // map zoom
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const ZOOM_MIN = 0.01;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.1;

  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const userZoomedRef = useRef(false);

  const canPan = zoom > fitZoom + 0.001;

  function computeFitZoom() {
    const viewport = mapViewportRef.current;
    const img = mapImgRef.current;
    if (!viewport || !img) return;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    if (!vw || !vh || !iw || !ih) return;

    const z = Math.min(vw / iw, vh / ih, 1);
    const rounded = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    setFitZoom(rounded);
    if (!userZoomedRef.current) setZoom(rounded);
  }

  function openMap() {
    userZoomedRef.current = false;
    setMapOpen(true);
    setZoom(1);
    setFitZoom(1);
  }

  function closeMap() {
    setMapOpen(false);
    userZoomedRef.current = false;
    setZoom(1);
    setFitZoom(1);
  }

  function zoomIn() {
    userZoomedRef.current = true;
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    userZoomedRef.current = true;
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  }

  function zoomReset() {
    userZoomedRef.current = false;
    setZoom(fitZoom);
  }

  function openWebcam() {
    const url = resort?.webcam_url?.trim();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // ✅ jedyna aktualizacja na stronie resortu
  const upd = resort?.resort_updated_at ?? null;

  async function loadSkipasses(resortUuid: string) {
    const cov = await supabase
      .from("skipass_coverage")
      .select(
        `
        resort_id,
        skipass_product_id,
        coverage_type,
        notes,
        created_at,
        skipass_products (
          id, name, provider, pass_type, currency, notes, url, season_label, last_checked_at, created_at
        )
      `
      )
      .eq("resort_id", resortUuid);

    if (cov.error) {
      setSkipassRows([]);
      return;
    }

    const covRows = (cov.data ?? []) as any as SkipassCoverageRow[];

    const products: SkipassProduct[] = [];
    for (const r of covRows) {
      const sp = r.skipass_products as any;
      if (!sp) continue;
      if (Array.isArray(sp)) {
        if (sp[0]) products.push(sp[0] as SkipassProduct);
      } else {
        products.push(sp as SkipassProduct);
      }
    }

    const byId = new Map<string, SkipassProduct>();
    for (const p of products) if (p?.id) byId.set(p.id, p);
    const uniqProducts = Array.from(byId.values());

    if (uniqProducts.length === 0) {
      setSkipassRows([]);
      return;
    }

    const ids = uniqProducts.map((p) => p.id);

    const pricesRes = await supabase
      .from("skipass_prices")
      .select(
        "id,skipass_product_id,category,duration_value,duration_unit,price,price_type,day_type,valid_from,valid_to,source_url,last_checked_at,created_at"
      )
      .in("skipass_product_id", ids)
      .not("price", "is", null);

    if (pricesRes.error) {
      setSkipassRows([]);
      return;
    }

    const allPricesRaw = (pricesRes.data ?? []) as any as SkipassPrice[];
    const today = new Date();
    const allPrices = allPricesRaw.filter((p) => isValidInRange(p, today));

    function pickBestPrice(list: SkipassPrice[]) {
      if (!list.length) return null;

      const score = (p: SkipassPrice) => {
        const cat = (p.category ?? "").toLowerCase();
        const isAdult = ["adult", "doros", "normal", "osoba dorosla", "dorośli", "dorosli"].some((k) => cat.includes(k));
        const dur = Number(p.duration_value ?? 9999);
        const price = Number(p.price ?? 1e18);
        return (isAdult ? 0 : 1) * 1_000_000 + dur * 1_000 + price;
      };

      const sorted = [...list].sort((a, b) => score(a) - score(b));
      return sorted[0] ?? null;
    }

    const grouped = new Map<string, SkipassPrice[]>();
    for (const p of allPrices) {
      if (!p.skipass_product_id) continue;
      if (!grouped.has(p.skipass_product_id)) grouped.set(p.skipass_product_id, []);
      grouped.get(p.skipass_product_id)!.push(p);
    }

    const final = uniqProducts.map((p) => {
      const plist = grouped.get(p.id) ?? [];
      const best = pickBestPrice(plist);

      const price = best?.price ?? null;
      const currency = p.currency ?? null;
      const url = (best?.source_url ?? p.url ?? null) as any;
      const label = labelFromPrice(best) || p.name || null;

      return {
        product: p,
        bestPrice: best,
        label,
        price: price !== null ? Number(price) : null,
        currency,
        url: url ? String(url) : null,
      };
    });

    final.sort((a, b) => {
      const ap = a.price ?? 1e18;
      const bp = b.price ?? 1e18;
      if (ap !== bp) return ap - bp;
      return String(a.product.name ?? "").localeCompare(String(b.product.name ?? ""), "pl");
    });

    setSkipassRows(final);
  }

  async function load() {
    if (resortId === null) return;

    setLoading(true);
    setError(null);

    // 1) ✅ bierzemy aktualizację + dane UI z VIEW (jak na głównej)
    const pub = await supabase
      .from("resorts_public_list")
      .select(
        `
        id,
        name,
        region,
        city,
        country,
        resort_updated_at,
        resort_stats (
          slopes_open,
          slopes_total,
          open_km,
          total_km,
          lifts_open,
          lifts_total,
          skipass_price,
          skipass_currency,
          skipass_url,
          skipass_label,
          stats_updated_at
        )
      `
      )
      .eq("id", String(resortId))
      .maybeSingle();

    if (pub.error) {
      setResort(null);
      setSlopes([]);
      setLifts([]);
      setSkipassRows([]);
      setError(pub.error.message);
      setLoading(false);
      return;
    }

    if (!pub.data) {
      setResort(null);
      setSlopes([]);
      setLifts([]);
      setSkipassRows([]);
      setError("Nie znaleziono resortu.");
      setLoading(false);
      return;
    }

    // 2) ✅ URL mapy/kamer/strony z tabeli resorts (bo view ich nie ma)
    const base = await supabase
      .from("resorts")
      .select("id,url,trail_map_url,webcam_url")
      .eq("id", String(resortId))
      .maybeSingle();

    if (base.error) {
      // nie blokujemy całej strony – brak url-i to nie dramat
      console.warn("[resorts base]", base.error);
    }

    const merged: Resort = {
      ...(pub.data as any),
      ...(base.data as any),
    };

    setResort(merged);

    // canonical slug
    const canonical = `${resortSlug(merged)}--${(merged as any).id}`;
    if (rawParam && rawParam !== canonical) router.replace(`/resort/${canonical}`);

    await loadSkipasses(String((merged as any).id));

    const s = await supabase
      .from("slopes")
      .select("id,number,resort,sector,name,difficulty,length_m,snow,light,status,updated_at")
      .eq("resort", String(resortId))
      .order("number", { ascending: true });

    if (s.error) {
      setSlopes([]);
      setLifts([]);
      setError(s.error.message);
      setLoading(false);
      return;
    }
    setSlopes((s.data ?? []) as any);

    const l = await supabase
      .from("lifts")
      .select("id,resort,number,name,type,seats,capacity_pph,length_m,status,updated_at")
      .eq("resort", String(resortId))
      .order("number", { ascending: true });

    if (l.error) setLifts([]);
    else setLifts((l.data ?? []) as any);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resortId]);

  useEffect(() => {
    if (!mapOpen) return;
    const onResize = () => computeFitZoom();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapOpen]);

  const stats = resort?.resort_stats ?? null;

  const slopesOpen = Number(stats?.slopes_open ?? 0);
  const slopesTotal = Number(stats?.slopes_total ?? 0);
  const openKm = Number(stats?.open_km ?? 0);
  const totalKm = Number(stats?.total_km ?? 0);

  const liftsOpen = Number(stats?.lifts_open ?? 0);
  const liftsTotal = Number(stats?.lifts_total ?? 0);
  const liftsClosed = Math.max(0, liftsTotal - liftsOpen);

  const kmByDifficulty = useMemo(() => {
    const out: Record<NormDifficulty, { total: number; open: number }> = {
      hard: { total: 0, open: 0 },
      difficult: { total: 0, open: 0 },
      medium: { total: 0, open: 0 },
      easy: { total: 0, open: 0 },
      unknown: { total: 0, open: 0 },
    };

    for (const sl of slopes) {
      const nd = normalizeDifficulty(sl.difficulty);
      const ns = normalizeStatus(sl.status);
      const km = mToKm(sl.length_m);
      out[nd].total += km;
      if (ns === "open") out[nd].open += km;
    }
    return out;
  }, [slopes]);

  const totalKmAll = totalKm || 0;

  const hasMap = Boolean(resort?.trail_map_url);
  const hasWebcam = Boolean(resort?.webcam_url && resort.webcam_url.trim().length > 0);

  const headerSubline =
    [resort?.city, resort?.region, resort?.country].filter((x) => x && String(x).trim().length).join(" • ") || "—";



  return (
    <div
      className="rt-root"
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        fontFamily: "system-ui, Arial",
        overflowX: "hidden",
      }}
    >
      <style>{`
        .rt-root, .rt-root * { box-sizing: border-box; }
        .rt-top { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; }
        .rt-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
        .rt-grid2 { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }

        @media (max-width: 860px) {
          .rt-top { flex-direction:column; align-items:flex-start; }
          .rt-actions { justify-content:flex-start; }
          .rt-grid2 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
        {/* ✅ banner jak na głównej, ale timestamp = resort_updated_at */}
        <ContentBanner updatedAt={upd} />
      </div>

      <main style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
        <a href="/" style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}>
          ← Wróć do listy resortów
        </a>

        <div className="rt-top" style={{ marginTop: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 900,
                margin: "10px 0 0",
                letterSpacing: -0.2,
                color: "#0f172a",
                lineHeight: 1.15,
              }}
            >
              {resort?.name ?? "—"}
            </h1>

            <div
              style={{
                marginTop: 2,
                color: "#94a3b8",
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
              title={headerSubline}
            >
              {headerSubline}
            </div>
          </div>

          <div style={{ textAlign: isMobile ? "left" : "right", width: isMobile ? "100%" : "auto" }}>
            {/* ✅ JEDYNA aktualizacja na tej stronie */}


            <div className="rt-actions" style={{ marginTop: 10 }}>
              {hasMap ? (
                <button onClick={openMap} style={btnGhost()}>
                  🗺️ Mapa tras
                </button>
              ) : (
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Brak mapy</span>
              )}

              {hasWebcam ? (
                <button onClick={openWebcam} style={btnGhost()}>
                  🎥 Kamery
                </button>
              ) : (
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Brak kamer</span>
              )}

              {resort?.url ? (
                <a href={resort.url} target="_blank" rel="noreferrer" style={{ ...btnGhost(), textDecoration: "none" }}>
                  Strona resortu
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, color: "#64748b", fontSize: 12 }}>
          Długość tras: <b style={{ color: "#0f172a" }}>{fmtKm(openKm)} km</b> / {fmtKm(totalKm)} km
        </div>

        {loading && <div style={{ marginTop: 10, color: "#475569", fontSize: 12 }}>Ładowanie…</div>}
        {error && <div style={{ marginTop: 10, color: "#dc2626", fontSize: 12 }}>Błąd: {error}</div>}

        <div className="rt-grid2" style={{ marginTop: 14, marginBottom: 14 }}>
          <DashCard
            icon="🎿"
            title="Trasy"
            leftLabel="Otwarte"
            leftValue={slopesOpen}
            rightLabel="Zamknięte"
            rightValue={Math.max(0, slopesTotal - slopesOpen)}
            footerLeft={`${fmtKm(openKm)} km`}
            footerRight={`${fmtKm(totalKm)} km`}
            footerHint="otwarte / wszystkie"
          />

          <DashCard
            icon="🚡"
            title="Wyciągi"
            leftLabel="Otwarte"
            leftValue={liftsOpen}
            rightLabel="Zamknięte"
            rightValue={liftsClosed}
            footerLeft={`${liftsTotal}`}
            footerRight=""
            footerHint="wszystkie"
          />
        </div>

        {/* ===================== SLOPES ===================== */}
        <CollapsibleSection
          title="Trasy"
          subtitle={`Lista tras w resorcie • ${slopes.length} pozycji`}
          open={slopesOpenUI}
          onToggle={() => setSlopesOpenUI((v) => !v)}
        >
          {isMobile ? (
            <div style={{ display: "grid", gap: 10 }}>
              {slopes.length === 0 && !loading && !error ? (
                <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, color: "#64748b" }}>
                  Brak tras dla tego resortu.
                </div>
              ) : (
                slopes.map((s, i) => {
                  const nd = normalizeDifficulty(s.difficulty);
                  const d = difficultyAccent(nd);
                  const ns = normalizeStatus(s.status);
                  const st = statusAccent(ns);

                  return (
                    <div
                      key={(s.id as any) ?? i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 12,
                        background: "#fff",
                        boxShadow: `inset 3px 0 0 ${d.dot}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                            <span
                              style={{
                                minWidth: 28,
                                textAlign: "right",
                                color: "#94a3b8",
                                fontWeight: 900,
                                flex: "0 0 auto",
                              }}
                            >
                              {s.number ?? "—"}
                            </span>

                            <span
                              style={{
                                minWidth: 0,
                                flex: "1 1 auto",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                display: "block",
                              }}
                              title={s.name ?? "—"}
                            >
                              {s.name ?? "—"}
                            </span>
                          </div>
                        </div>

                        <Marker dot={st.dot} fg={st.fg}>
                          {statusLabel(ns)}
                        </Marker>
                      </div>

                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
                        <Chip label={`Trudność: ${difficultyLabel(nd)}`} dot={d.dot} />
                        <Chip label={`Długość: ${s.length_m ? `${s.length_m} m` : "—"}`} />
                        <Chip label={`Sektor: ${s.sector ?? "—"}`} />
                        <Chip label={`💡 ${hasLight(s.light) ? "Tak" : "Nie"}`} />
                        <Chip label={`❄️ ${hasSnow(s.snow) ? "Tak" : "Nie"}`} />
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
                        Aktualizacja (trasa): <b style={{ color: "#64748b" }}>{fmtDate(s.updated_at ?? null)}</b>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead style={{ background: "#fafcff" }}>
                    <tr>
                      <Th style={{ width: 60, whiteSpace: "nowrap" }}>Nr</Th>
                      <Th>Nazwa</Th>
                      <Th style={{ width: 170 }}>Sektor</Th>
                      <Th style={{ width: 140 }}>Trudność</Th>
                      <Th style={{ width: 90, whiteSpace: "nowrap" }}>Długość</Th>
                      <Th style={{ width: 110, textAlign: "center" }}>Oświetlenie</Th>
                      <Th style={{ width: 110, textAlign: "center" }}>Naśnieżanie</Th>
                      <Th style={{ width: 140 }}>Status</Th>
                      <Th style={{ width: 180, whiteSpace: "nowrap" }}>Ostatnia aktualizacja</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {slopes.length === 0 && !loading && !error ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 16, color: "#64748b", fontSize: 13 }}>
                          Brak tras dla tego resortu.
                        </td>
                      </tr>
                    ) : (
                      slopes.map((s, i) => {
                        const nd = normalizeDifficulty(s.difficulty);
                        const d = difficultyAccent(nd);

                        const ns = normalizeStatus(s.status);
                        const st = statusAccent(ns);

                        const muted = ns === "closed";

                        return (
                          <tr
                            key={(s.id as any) ?? i}
                            style={{
                              borderTop: "1px solid #f1f5f9",
                              boxShadow: `inset 3px 0 0 ${d.dot}`,
                              color: muted ? "#64748b" : "#0f172a",
                              background: "#ffffff",
                            }}
                          >
                            <Td style={{ width: 60, whiteSpace: "nowrap" }}>{s.number ?? "—"}</Td>

                            <Td strong>
                              <div style={{ maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.name ?? "—"}
                              </div>
                            </Td>

                            <Td>
                              <div style={{ maxWidth: 170, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.sector ?? "—"}
                              </div>
                            </Td>

                            <Td>
                              <Marker dot={d.dot} fg={d.fg}>
                                {difficultyLabel(nd)}
                              </Marker>
                            </Td>

                            <Td style={{ whiteSpace: "nowrap" }}>{s.length_m ? `${s.length_m} m` : "—"}</Td>

                            <Td style={{ textAlign: "center" }}>
                              <span title={hasLight(s.light) ? "Trasa oświetlona" : "Brak oświetlenia"}>{lightLabel(s.light)}</span>
                            </Td>

                            <Td style={{ textAlign: "center" }}>
                              <span title={hasSnow(s.snow) ? "Trasa naśnieżana" : "Brak naśnieżania"}>{snowLabel(s.snow)}</span>
                            </Td>

                            <Td>
                              <Marker dot={st.dot} fg={st.fg}>
                                {statusLabel(ns)}
                              </Marker>
                            </Td>

                            <Td style={{ whiteSpace: "nowrap" }}>
                              <span title={s.updated_at ?? ""}>{fmtDate(s.updated_at ?? null)}</span>
                            </Td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DifficultyStats kmByDifficulty={kmByDifficulty} totalKm={totalKm} totalKmAll={totalKmAll} />
        </CollapsibleSection>

        {/* ===================== LIFTS ===================== */}
        <div style={{ marginTop: 14 }}>
          <CollapsibleSection
            title="Wyciągi"
            subtitle={`Lista wyciągów w resorcie • ${lifts.length} pozycji`}
            open={liftsOpenUI}
            onToggle={() => setLiftsOpenUI((v) => !v)}
          >
            {isMobile ? (
              <div style={{ display: "grid", gap: 10 }}>
                {lifts.length === 0 ? (
                  <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, color: "#64748b" }}>
                    Brak danych o wyciągach.
                  </div>
                ) : (
                  lifts.map((l, i) => {
                    const ns = normalizeStatus(l.status);
                    const st = statusAccent(ns);

                    return (
                      <div key={(l.id as any) ?? i} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                              <span style={{ minWidth: 28, textAlign: "right", color: "#94a3b8", fontWeight: 900, flex: "0 0 auto" }}>
                                {l.number ?? "—"}
                              </span>
                              <span
                                style={{ minWidth: 0, flex: "1 1 auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
                                title={l.name ?? "—"}
                              >
                                {l.name ?? "—"}
                              </span>
                            </div>
                          </div>

                          <Marker dot={st.dot} fg={st.fg}>
                            {statusLabel(ns)}
                          </Marker>
                        </div>

                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
                          <Chip label={`Typ: ${l.type ?? "—"}`} />
                          <Chip label={`Miejsca: ${l.seats ?? "—"}`} />
                          <Chip label={`PPH: ${l.capacity_pph ? `${l.capacity_pph}/h` : "—"}`} />
                          <Chip label={`Długość: ${l.length_m ? `${l.length_m} m` : "—"}`} />
                        </div>

                        <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
                          Aktualizacja (wyciąg): <b style={{ color: "#64748b" }}>{fmtDate(l.updated_at ?? null)}</b>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead style={{ background: "#fafcff" }}>
                      <tr>
                        <Th style={{ width: 60 }}>Nr</Th>
                        <Th>Nazwa</Th>
                        <Th style={{ width: 120 }}>Typ</Th>
                        <Th style={{ width: 90 }}>Miejsca</Th>
                        <Th style={{ width: 120 }}>Przepustowość</Th>
                        <Th style={{ width: 100 }}>Długość</Th>
                        <Th style={{ width: 140 }}>Status</Th>
                        <Th style={{ width: 180 }}>Aktualizacja</Th>
                      </tr>
                    </thead>

                    <tbody>
                      {lifts.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: 16, fontSize: 13, color: "#64748b" }}>
                            Brak danych o wyciągach.
                          </td>
                        </tr>
                      ) : (
                        lifts.map((l, i) => {
                          const ns = normalizeStatus(l.status);
                          const st = statusAccent(ns);

                          return (
                            <tr key={(l.id as any) ?? i} style={{ borderTop: "1px solid #f1f5f9", color: ns === "closed" ? "#64748b" : "#0f172a", background: "#ffffff" }}>
                              <Td>{l.number ?? "—"}</Td>

                              <Td strong>
                                <div style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name ?? "—"}</div>
                              </Td>

                              <Td>{l.type ?? "—"}</Td>
                              <Td>{l.seats ?? "—"}</Td>
                              <Td>{l.capacity_pph ? `${l.capacity_pph}/h` : "—"}</Td>
                              <Td>{l.length_m ? `${l.length_m} m` : "—"}</Td>

                              <Td>
                                <Marker dot={st.dot} fg={st.fg}>
                                  {statusLabel(ns)}
                                </Marker>
                              </Td>

                              <Td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.updated_at ?? null)}</Td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* ===================== SKIPASSES ===================== */}
        <div style={{ marginTop: 14 }}>
          <CollapsibleSection
            title="Skipassy"
            subtitle={`Wszystkie przypięte skipassy wg skipass_coverage • ${skipassRows.length} pozycji (ceny tylko ważne dziś)`}
            open={skipassOpenUI}
            onToggle={() => setSkipassOpenUI((v) => !v)}
          >
            {isMobile ? (
              <div style={{ display: "grid", gap: 10 }}>
                {skipassRows.length === 0 ? (
                  <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, color: "#64748b" }}>
                    Brak przypiętych skipassów lub brak aktualnych cen (valid_from/valid_to).
                  </div>
                ) : (
                  skipassRows.map((row, i) => {
                    const name = row.product.name ?? "—";
                    const season = row.product.season_label ?? "—";
                    const hasPrice = row.price !== null && Number.isFinite(Number(row.price));
                    const cur = (row.currency ?? "PLN").toUpperCase();
                    const label = row.label;

                    return (
                      <div key={`${row.product.id}-${i}`} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>{name}</div>
                        {row.product.provider ? <div style={{ marginTop: 2, fontSize: 12, color: "#94a3b8" }}>{row.product.provider}</div> : null}

                        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ color: "#64748b", fontSize: 12 }}>Sezon</span>
                            <b style={{ color: "#0f172a", fontSize: 12 }}>{season}</b>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ color: "#64748b", fontSize: 12 }}>Cena</span>
                            {hasPrice ? (
                              row.url ? (
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: "#0f172a", fontWeight: 900, textDecoration: "underline", textUnderlineOffset: 3 }}
                                >
                                  {fmtMoney(Number(row.price), cur)}
                                </a>
                              ) : (
                                <b style={{ color: "#0f172a" }}>{fmtMoney(Number(row.price), cur)}</b>
                              )
                            ) : (
                              <span style={{ color: "#94a3b8" }}>—</span>
                            )}
                          </div>

                          <div style={{ color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label ?? ""}>
                            {label ?? "—"}
                          </div>

                          {row.product.url ? (
                            <a href={row.product.url} target="_blank" rel="noreferrer" style={{ ...btnGhost(), textDecoration: "none", width: "fit-content" }}>
                              Cennik
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}

                <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 14, fontSize: 12, color: "#94a3b8" }}>
                  Ceny są filtrowane po <b>valid_from</b> / <b>valid_to</b> (pokazujemy tylko te, które obowiązują dziś).
                </div>
              </div>
            ) : (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                    <thead style={{ background: "#fafcff" }}>
                      <tr>
                        <Th>Produkt</Th>
                        <Th style={{ width: 160 }}>Sezon</Th>
                        <Th style={{ width: 140 }}>Cena</Th>
                        <Th style={{ width: 260 }}>Opis</Th>
                        <Th style={{ width: 90 }}>Link</Th>
                      </tr>
                    </thead>

                    <tbody>
                      {skipassRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 16, fontSize: 13, color: "#64748b" }}>
                            Brak przypiętych skipassów (skipass_coverage) lub brak aktualnych cen (valid_from/valid_to).
                          </td>
                        </tr>
                      ) : (
                        skipassRows.map((row, i) => {
                          const name = row.product.name ?? "—";
                          const season = row.product.season_label ?? "—";
                          const hasPrice = row.price !== null && Number.isFinite(Number(row.price));
                          const cur = (row.currency ?? "PLN").toUpperCase();
                          const label = row.label;

                          return (
                            <tr key={`${row.product.id}-${i}`} style={{ borderTop: "1px solid #f1f5f9", background: "#ffffff" }}>
                              <Td strong>
                                <div style={{ maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={name}>
                                  {name}
                                </div>
                                {row.product.provider ? <div style={{ marginTop: 2, fontSize: 11, color: "#94a3b8" }}>{row.product.provider}</div> : null}
                              </Td>

                              <Td>{season}</Td>

                              <Td>
                                {hasPrice ? (
                                  row.url ? (
                                    <a
                                      href={row.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: "#0f172a", textDecoration: "underline", textUnderlineOffset: 3, fontWeight: 800, whiteSpace: "nowrap" }}
                                      title="Źródło ceny / cennik"
                                    >
                                      {fmtMoney(Number(row.price), cur)}
                                    </a>
                                  ) : (
                                    <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{fmtMoney(Number(row.price), cur)}</span>
                                  )
                                ) : (
                                  <span style={{ color: "#94a3b8" }}>—</span>
                                )}

                                {label ? (
                                  <div
                                    style={{
                                      marginTop: 4,
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      lineHeight: 1.2,
                                      maxWidth: 240,
                                    }}
                                    title={label}
                                  >
                                    {label}
                                  </div>
                                ) : null}
                              </Td>

                              <Td>
                                <div style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label ?? ""}>
                                  {label ?? "—"}
                                </div>
                              </Td>

                              <Td>
                                {row.product.url ? (
                                  <a href={row.product.url} target="_blank" rel="noreferrer" style={{ color: "#0f172a", textDecoration: "underline", textUnderlineOffset: 3, fontWeight: 700 }}>
                                    cennik
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

                <div style={{ padding: 12, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#94a3b8" }}>
                  Ceny są filtrowane po <b>valid_from</b> / <b>valid_to</b> (pokazujemy tylko te, które obowiązują dziś).
                </div>
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* ===================== MAP MODAL ===================== */}
        {mapOpen && resort?.trail_map_url ? (
          <div
            onClick={closeMap}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
              zIndex: 9999,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(1100px, 98vw)",
                height: "min(720px, 92vh)",
                background: "#ffffff",
                borderRadius: 16,
                border: "1px solid #e2e8f0",
                overflow: "hidden",
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "12px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #e2e8f0",
                  background: "#ffffff",
                }}
              >
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13 }}>Mapa tras • {resort?.name ?? "—"}</div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={zoomOut} style={btnSquare()} title="Pomniejsz">
                    −
                  </button>
                  <div style={{ fontSize: 12, color: "#475569", width: 64, textAlign: "center" }}>{Math.round(zoom * 100)}%</div>
                  <button onClick={zoomIn} style={btnSquare()} title="Powiększ">
                    +
                  </button>
                  <button onClick={zoomReset} style={btnGhostSmall()} title="Dopasuj do okna">
                    Dopasuj
                  </button>
                  <button onClick={closeMap} style={btnGhostSmall()} title="Zamknij">
                    ✕
                  </button>
                </div>
              </div>

              <div
                ref={mapViewportRef}
                style={{
                  position: "relative",
                  flex: 1,
                  background: "#f8fafc",
                  overflow: canPan ? "auto" : "hidden",
                  display: canPan ? "block" : "flex",
                  alignItems: canPan ? undefined : "center",
                  justifyContent: canPan ? undefined : "center",
                }}
              >
                <div
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: canPan ? "top left" : "center center",
                    display: "inline-block",
                  }}
                >
                  <img
                    ref={mapImgRef}
                    src={resort.trail_map_url ?? ""}
                    alt="Mapa tras"
                    onLoad={() => computeFitZoom()}
                    style={{ display: "block", maxWidth: "none", width: "auto", height: "auto" }}
                  />
                </div>

                <div
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    fontSize: 12,
                    color: "#64748b",
                    background: "rgba(255,255,255,0.9)",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: "8px 10px",
                  }}
                >
                  {canPan ? "Scroll = przesuwanie • +/− = zoom" : "Widok dopasowany • +/− = zoom (po powiększeniu pojawi się przewijanie)"}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/* ===================== BANNER (jak na głównej) ===================== */

function ContentBanner({ updatedAt }: { updatedAt: string | null }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", background: "#fafcff" }}>
      <div style={{ width: "100%", aspectRatio: "1470 / 300", background: "#fafcff" }}>
        <img
          src="/baner.png"
          alt="otwartestoki banner"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }}
        />
      </div>
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
        Ostatnia aktualizacja: <b style={{ color: "#0f172a" }}>{fmtDate(updatedAt)}</b>
      </div>
    </div>
  );
}

/* ===================== UI ===================== */

function CollapsibleSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: any;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          textAlign: "left",
          border: "1px solid #e2e8f0",
          background: "#ffffff",
          borderRadius: 14,
          padding: "12px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{subtitle}</div> : null}
        </div>

        <div
          style={{
            minWidth: 34,
            height: 34,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 900,
            color: "#0f172a",
          }}
          title={open ? "Zwiń" : "Rozwiń"}
        >
          {open ? "▾" : "▸"}
        </div>
      </button>

      {open ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </div>
  );
}

function DashCard({
  icon,
  title,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  footerLeft,
  footerRight,
  footerHint,
}: {
  icon: string;
  title: string;
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  footerLeft?: string;
  footerRight?: string;
  footerHint?: string;
}) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#ffffff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            {icon}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>{title}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{footerHint ?? ""}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, textAlign: "right" }}>
          {footerLeft ? <span style={{ color: "#0f172a" }}>{footerLeft}</span> : null}
          {footerRight ? <span style={{ color: "#94a3b8" }}> / {footerRight}</span> : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{leftLabel}</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{leftValue}</div>
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{rightLabel}</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{rightValue}</div>
        </div>
      </div>
    </div>
  );
}

function DifficultyStats({
  kmByDifficulty,
  totalKm,
  totalKmAll,
}: {
  kmByDifficulty: Record<NormDifficulty, { total: number; open: number }>;
  totalKm: number;
  totalKmAll: number;
}) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", padding: 12, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>Długość tras wg trudności</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          otwarte / wszystkie • razem: <b style={{ color: "#0f172a" }}>{fmtKm(totalKm)} km</b>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
        {(["easy", "medium", "difficult", "hard", "unknown"] as NormDifficulty[])
          .filter((k) => k !== "unknown" || (kmByDifficulty.unknown?.total ?? 0) > 0.01)
          .map((k) => {
            const a = difficultyAccent(k);
            const label = difficultyLabel(k);
            const open = kmByDifficulty[k]?.open ?? 0;
            const total = kmByDifficulty[k]?.total ?? 0;

            const pctOfAll = totalKmAll > 0 ? Math.max(0, Math.min(1, total / totalKmAll)) : 0;
            const openPct = total > 0 ? Math.max(0, Math.min(1, open / total)) : 0;

            return (
              <div key={k} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: a.dot }} />
                    <span style={{ fontWeight: 900, fontSize: 13, color: "#0f172a" }}>{label}</span>
                  </div>

                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                    <span style={{ color: "#0f172a" }}>{fmtKm(open)}</span> / {fmtKm(total)} km
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      width: "100%",
                      height: 10,
                      borderRadius: 999,
                      background: "#f1f5f9",
                      overflow: "hidden",
                      border: "1px solid #e2e8f0",
                    }}
                    title={`Udział tej trudności: ${Math.round(pctOfAll * 100)}%`}
                  >
                    <div style={{ width: `${Math.round(pctOfAll * 100)}%`, height: "100%", background: "rgba(148,163,184,0.35)" }}>
                      <div style={{ width: `${Math.round(openPct * 100)}%`, height: "100%", background: a.dot }} />
                    </div>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "#94a3b8" }}>Udział: {Math.round(pctOfAll * 100)}%</span>
                    <span style={{ color: "#94a3b8" }}>Otwarte: {total > 0 ? Math.round(openPct * 100) : 0}%</span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
        Pasek: <b style={{ color: "#64748b" }}>szary</b> = udział danej trudności w całym resorcie,{" "}
        <b style={{ color: "#64748b" }}>kolor</b> = część otwarta w tej trudności.
      </div>
    </div>
  );
}

function Chip({ label, dot }: { label: string; dot?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 999,
        border: "1px solid #e2e8f0",
        background: "#ffffff",
        color: "#0f172a",
        fontSize: 12,
        fontWeight: 800,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: "0 1 auto",
      }}
      title={label}
    >
      {dot ? <span style={{ width: 9, height: 9, borderRadius: 99, background: dot, display: "inline-block", flex: "0 0 auto" }} /> : null}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}

type ThProps = React.ThHTMLAttributes<HTMLTableCellElement> & { children: React.ReactNode };
function Th({ children, style, ...props }: ThProps) {
  return (
    <th
      {...props}
      style={{
        textAlign: "left",
        padding: "10px 10px",
        fontSize: 12,
        color: "#64748b",
        fontWeight: 700,
        ...(style as React.CSSProperties),
      }}
    >
      {children}
    </th>
  );
}

type TdProps = React.TdHTMLAttributes<HTMLTableCellElement> & { children: React.ReactNode; strong?: boolean };
function Td({ children, strong, style, ...props }: TdProps) {
  return (
    <td
      {...props}
      style={{
        padding: "10px 10px",
        verticalAlign: "middle",
        fontSize: 13,
        color: "inherit",
        fontWeight: strong ? 800 : 500,
        ...(style as React.CSSProperties),
      }}
    >
      {children}
    </td>
  );
}

function Marker({ children, fg, dot }: { children: any; fg: string; dot: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: fg, fontSize: 13, fontWeight: 800 }}>
      <span style={{ width: 9, height: 9, borderRadius: 99, background: dot, display: "inline-block" }} />
      {children}
    </span>
  );
}

/* ===================== BUTTONS ===================== */

function btnGhost() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    lineHeight: 1,
  } as const;
}

function btnGhostSmall() {
  return {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
    lineHeight: 1,
  } as const;
}

function btnSquare() {
  return {
    width: 36,
    height: 34,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 16,
    lineHeight: "34px",
    textAlign: "center" as const,
  } as const;
}
