import { load } from "cheerio";
import type { Candidate, Json, Source, Status } from "./types";
import { norm } from "./matching";
import { normalizeStatus } from "./validation";

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
export function numberFromName(name: string) {
  return name.match(/^trasa\s*(?:nr\.?\s*)?([A-Za-z]*\d+(?:\/\d+)?[A-Za-z]*)(?:\s|$)/i)?.[1] || name.match(/^(?:wyciąg\s+|kolej linowa\s+|orczyk\s+|przenośnik\s+taśmowy\(taśma\)\s*)([A-Z])$/i)?.[1] || "";
}
type Data = Record<string, unknown>;
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export function parseSource(source: Source, content: string): Candidate[] {
  const result: Candidate[] = [];
  function add(kind: "slope" | "lift", identifier: unknown, name: unknown, status: Status, raw: unknown, number: unknown = "", length: unknown = null, updated: unknown = null, evidence: unknown = null) {
    result.push({ source_id: `${source.id}:${kind}:${identifier}`, source: source.id, resort_id: source.resort_id, kind, name: text(name), number: text(number), status, raw_status: (raw ?? null) as Json, length_m: (length ?? null) as Json, source_updated_at: typeof updated === "string" ? updated : null, url: source.url, evidence: evidence as Json });
  }
  const mode = source.adapter;
  if (["berg", "bialka", "holiday"].includes(mode)) {
    const data: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (mode === "berg") {
      const station = obj(data);
      if (!source.expected_station || norm(station.skiStationName) !== norm(source.expected_station)) throw new Error("Źródło zwróciło inny ośrodek.");
      for (const [key, kind, statusKey] of [["runs", "slope", "state"], ["lifts", "lift", "status"]] as const) for (const value of array(station[key])) {
        const row = obj(value), raw = row[statusKey];
        add(kind, row.id, row.name, row.partiallyOpen ? "partial" : raw === "OPEN" ? "open" : raw === "CLOSED" ? "closed" : "unknown", raw, numberFromName(text(row.name)), row.length, row.lastUpdate);
      }
    } else if (mode === "bialka") {
      for (const [id, value] of Object.entries(obj(data))) {
        const row = obj(value), kind = row["object-type"] === "ski-run" ? "slope" : row["object-type"] === "lift" ? "lift" : null;
        if (!kind) continue;
        const live = obj(row.live), c = obj(row.content), raw = live.active;
        let number = text(c.no) || (kind === "lift" ? text(c.title).match(/^Kolej ([IVX]+) -/)?.[1] || "" : "");
        if (kind === "slope") number = number.replace(/^FIS-/, "");
        add(kind, id, c.title || id, [1, true, "1"].includes(raw as string) ? "open" : [0, false, "0"].includes(raw as string) ? "closed" : "unknown", raw, number, obj(row.data).length);
      }
    } else {
      if (!source.kind || !Array.isArray(data)) throw new Error("Nieprawidłowe dane Holidayinfo.");
      const maps: Record<string, Record<string, Status>> = { lift: { "1": "open", "2": "closed", "3": "partial" }, slope: { "2": "open", "3": "closed", "6": "partial" } };
      for (const value of data) { const row = obj(value); add(source.kind, row.id, row.name, maps[source.kind][text(row.status)] || "unknown", row.status, row.id, row.length); }
    }
    return result;
  }
  const $ = load(content); $("script,style").remove();
  const txt = (el: Parameters<typeof $>[0]) => text($(el).text());
  if (mode === "tables") {
    const records = new Map<string, Candidate>();
    $("table").each((_, table) => {
      const rows = $(table).find("tr").toArray(); let start = -1, nameCol = -1, category = "";
      for (let i = 0; i < rows.length; i++) {
        const headers = $(rows[i]).children("td,th").toArray().map(c => txt(c).toLowerCase());
        if (headers.includes("status") && headers.includes("nazwa")) { nameCol = headers.indexOf("nazwa"); category = source.legacy === "jaworzyna" ? "slope" : "mixed"; }
        else if (headers.includes("wyciąg")) { nameCol = headers.indexOf("wyciąg"); category = "lift"; }
        else if (headers.includes("trasa") || headers.includes("trasy")) { nameCol = Math.max(headers.indexOf("trasa"), headers.indexOf("trasy")); category = "slope"; }
        else continue;
        start = i; break;
      }
      if (start < 0) return;
      for (const row of rows.slice(start + 1)) {
        const cells = $(row).children("td,th").toArray().map(c => txt(c));
        const statuses = cells.map(c => ({ raw: c, status: normalizeStatus(c) })).filter(c => c.status !== "unknown");
        if (!statuses.length || !cells[nameCol]) continue;
        if (new Set(statuses.map(s => s.status)).size > 1) throw new Error("Sprzeczne statusy w wierszu źródła.");
        const name = cells[nameCol].split(/\s+(?:Koniec sezonu|Z uwagi na)\b/)[0]; let kind = category;
        if (kind === "mixed") {
          if (/wypożyczalnia|serwis/i.test(name)) continue;
          kind = /trasa|nartostrada|polana/i.test(name) ? "slope" : /kolej/i.test(name) || name.toLowerCase() === "mosorny groń" ? "lift" : "";
        }
        if (!kind) continue;
        kind = source.force_kind || kind;
        const number = (kind === "lift" && /^[A-Za-z]+\d+$/.test(name) ? name : "") || (cells[0] !== name && /^[A-Za-z]*\d+[A-Za-z]*$/.test(cells[0]) ? cells[0] : "") || numberFromName(name) || (kind === "lift" && /^[A-Za-z]+\d+$/.test(name) ? name : "") || name.match(/\b(?:Trasa|Nartostrada) nr\s+(\d+[A-Za-z]*)/i)?.[1] || "";
        const key = `${kind}:${number}:${name.toLowerCase()}`;
        const previous = records.get(key);
        if (previous && previous.status !== statuses[0].status) throw new Error("Sprzeczne duplikaty obiektu.");
        if (!previous) { add(kind as "slope" | "lift", key, name, statuses[0].status, statuses[0].raw, number, null, null, cells); records.set(key, result[result.length - 1]); }
      }
    });
  } else if (["pkl-lifts", "bsa", "bsa-lifts", "cienkow"].includes(mode)) {
    $("tr").each((_, row) => {
      const cells = $(row).children("td,th").toArray().map(c => txt(c));
      if (mode === "pkl-lifts" && cells.length >= 3 && normalizeStatus(cells[0]) !== "unknown") {
        const number = cells[2].match(/^([A-Z])\s*-\s*/)?.[1];
        if (number) add("lift", number, cells[2], normalizeStatus(cells[0]), cells[0], number, null, null, cells);
      } else if (mode !== "pkl-lifts" && (mode === "cienkow" ? cells.length >= 2 : cells.length === 9) && /^\d+$/.test(cells[0] || "")) {
        const raw = mode === "cienkow" ? cells[1] : cells[cells.length - 1];
        if (normalizeStatus(raw) === "unknown") return;
        add(mode === "bsa-lifts" ? "lift" : "slope", cells[0], mode === "bsa-lifts" ? cells[1] : `Trasa ${cells[0]}`, normalizeStatus(raw), raw, mode === "bsa-lifts" ? "" : cells[0], mode === "bsa" ? cells[2] : mode === "bsa-lifts" ? cells[3] : null, null, cells);
      }
    });
  } else if (mode === "wierchomla") {
    $("table").each((_, table) => {
      const heading = txt(table), kind = heading.includes("Czas wjazdu") ? "lift" : heading.includes("Trudność") ? "slope" : null;
      if (!kind) return;
      $(table).find("tr").each((_, row) => {
        const c = $(row).children("td,th"); if (c.length < 2) return;
        const flags = c.eq(1).find("[class]").toArray().map(el => $(el).attr("class") || "").join(" ");
        const status = flags.includes("availability-type--nie") ? "closed" : flags.includes("availability-type--tak") ? "open" : null;
        if (status) add(kind, txt(c[0]), txt(c[0]), status, flags, "", null, null, txt(row));
      });
    });
  } else if (mode === "maleciche") {
    $("tr").each((_, row) => {
      const c = $(row).children("td,th"); if (c.length !== 2) return;
      const flags = c.eq(1).find("[class]").toArray().map(el => $(el).attr("class") || "").join(" ");
      const status = flags.includes("glyphicon-remove") ? "closed" : flags.includes("glyphicon-ok") ? "open" : null;
      if (status && /^(Kolej|Wyciąg)/.test(txt(c[0]))) add("lift", txt(c[0]), txt(c[0]), status, flags, "", null, null, txt(row));
    });
  } else if (mode === "czarnagora") {
    $("table[data-table_content]").each((_, table) => {
      const kind = $(table).attr("data-table_content") === "trails" ? "slope" : $(table).attr("data-table_content") === "lifts" ? "lift" : null;
      if (!kind) return;
      $(table).find("tbody").each((_, block) => {
        const values: Record<string, string> = {}; let statusUrl = "";
        $(block).find("tr").each((_, row) => { const c = $(row).children("td,th"); if (c.length === 2) { values[txt(c[0])] = txt(c[1]); if (txt(c[0]) === "Status") statusUrl = c.eq(1).find("img").attr("src") || ""; } });
        if (values.Nazwa) add(kind, values.Nazwa, values.Nazwa, statusUrl.endsWith("/sm-close.png") ? "closed" : statusUrl.endsWith("/sm-open.png") ? "open" : "unknown", statusUrl, kind === "slope" ? values.Nazwa : "", null, null, values);
      });
    });
  } else if (mode === "szrenica") {
    let kind: "slope" | "lift" | null = null, name = "";
    $("h1,h2,h3,h4,h5,h6,.nieczynny,.czynny").each((_, el) => {
      if (/^h[1-6]$/.test(el.tagName)) {
        const label = txt(el);
        if (["Koleje linowe", "Wyciągi narciarskie"].includes(label)) { kind = "lift"; name = ""; }
        else if (label === "Nartostrady") { kind = "slope"; name = ""; } else name = label;
      }
      if (kind && name && ($(el).hasClass("nieczynny") || $(el).hasClass("czynny")) && normalizeStatus(txt(el)) !== "unknown") add(kind, name, name, normalizeStatus(txt(el)), txt(el));
    });
  } else if (mode === "czarnow") {
    $("h3").each((_, el) => { const value = txt($(el).parent()[0]); if (value.includes("ZAMKNIĘTA - SEZON ZAKOŃCZONY")) add("slope", txt(el), txt(el), "closed", "ZAMKNIĘTA - SEZON ZAKOŃCZONY", "", value.match(/Długość:\s*(\d+)/)?.[1], null, value); });
  } else if (mode === "skidolina") {
    $(".warObiekt").each((_, el) => { const name = text($(el).find(".TopLeft").first().text()), raw = text($(el).find(".TopRight").first().text()); if (name && normalizeStatus(raw) !== "unknown") add("lift", name, name, normalizeStatus(raw), raw, "", null, null, txt(el)); });
  } else if (mode === "tylicz") {
    $(".status-row").each((_, el) => { const raw = text($(el).find(".status-badge").text()), name = text($(el).children("span:not(.status-badge)").first().text()); if (normalizeStatus(raw) !== "unknown") add($(el).hasClass("status-row-trail") ? "slope" : "lift", name, name, normalizeStatus(raw), raw, numberFromName(name), null, null, txt(el)); });
  } else throw new Error("Brak obsługi tego formatu źródła.");
  return result;
}
