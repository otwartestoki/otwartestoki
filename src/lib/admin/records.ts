import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient, dbFailure } from "./server";
import { tableSchema } from "./schema";
import { HttpError, normalizeStatus, recordIdentity, validateChanges } from "./validation";
import type { DatabaseSource, Row } from "./types";
import { utcTimestamp } from "../skiAvailability";
import { digitalOceanRead, digitalOceanWriter } from "./digitalocean";

function secret() { const s = process.env.ADMIN_REVISION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; if (!s) throw new HttpError(503,"Brak konfiguracji serwera."); return s; }
function signature(s: string) { return createHmac("sha256",secret()).update(s).digest("base64url"); }
type RevisionState = { table: string; source: DatabaseSource; records: Record<DatabaseSource, Row | null>; expires: number };
export function revisionFor(table: string, records: Record<DatabaseSource, Row | null>, source: DatabaseSource) {
  const payload = Buffer.from(JSON.stringify({table,records,source,expires:Date.now()+3600000})).toString("base64url");
  return payload+"."+signature(payload);
}
function decode(token: string, table: string): RevisionState {
  const [p,s] = token.split("."); const expected = signature(p || "");
  if (!s || s.length !== expected.length || !timingSafeEqual(Buffer.from(s),Buffer.from(expected))) throw new HttpError(400,"Nieprawidłowa wersja wpisu.");
  try {
    const data=JSON.parse(Buffer.from(p,"base64url").toString()) as RevisionState;
    if(data.table!==table || data.expires<Date.now() || !["supabase","droplet"].includes(data.source) || !data.records || !("supabase" in data.records) || !("droplet" in data.records)) throw Error();
    return data;
  } catch { throw new HttpError(409,"Odczytaj wpis ponownie: wersja wygasła."); }
}
export async function readRecord(table: string, identity: unknown) {
  const spec=tableSchema(table), keys=recordIdentity(spec,identity); let q=adminClient().from(table).select("*");
  for(const [k,v] of Object.entries(keys)) q=q.eq(k,v);
  const {data,error}=await q.single(); if(error) dbFailure(error); return data as Row;
}
export async function listRecords(table: string) {
  const spec=tableSchema(table); const rows: Row[]=[];
  for(let start=0;start<10000;start+=500) { const {data,error}=await adminClient().from(table).select("*").order(spec.keys[0]).range(start,start+499); if(error) dbFailure(error); rows.push(...data); if(data.length<500) return rows; }
  throw new HttpError(413,"Zbyt wiele wpisów do jednorazowego odczytu.");
}
export async function listRecordsFrom(table: string, source: DatabaseSource) {
  if(source==="supabase") return listRecords(table);
  return (await digitalOceanRead<{ rows: Row[] }>({ table, action: "list" })).rows;
}
export async function listRecordsBoth(table: string) {
  const [supabase, droplet] = await Promise.allSettled([
    listRecords(table),
    digitalOceanRead<{ rows: Row[] }>({ table, action: "list" }),
  ]);
  return {
    supabase: supabase.status === "fulfilled" ? { ok: true as const, rows: supabase.value } : { ok: false as const, error: "Nie udało się odczytać Supabase." },
    droplet: droplet.status === "fulfilled" ? { ok: true as const, rows: droplet.value.rows } : { ok: false as const, error: droplet.reason instanceof Error ? droplet.reason.message : "Nie udało się odczytać Dropleta." },
  };
}
export async function readRecordBoth(table: string, identity: unknown) {
  const spec = tableSchema(table), keys = recordIdentity(spec, identity);
  const supabaseRead = async () => {
    let q = adminClient().from(table).select("*");
    for (const [key, value] of Object.entries(keys)) q = q.eq(key, value);
    const { data, error } = await q.maybeSingle();
    if (error) dbFailure(error);
    return data as Row | null;
  };
  const [supabase, droplet] = await Promise.allSettled([
    supabaseRead(),
    digitalOceanRead<{ record: Row | null }>({ table, action: "record", identity: keys }),
  ]);
  return {
    supabase: supabase.status === "fulfilled" ? { ok: true as const, record: supabase.value } : { ok: false as const, error: "Nie udało się odczytać Supabase." },
    droplet: droplet.status === "fulfilled" ? { ok: true as const, record: droplet.value.record } : { ok: false as const, error: droplet.reason instanceof Error ? droplet.reason.message : "Nie udało się odczytać Dropleta." },
  };
}
export async function readRecordFrom(table: string, identity: unknown, source: DatabaseSource) {
  if(source==="supabase") return readRecord(table,identity);
  const spec=tableSchema(table), keys=recordIdentity(spec,identity);
  const result=await digitalOceanRead<{record:Row|null}>({table,action:"record",identity:keys});
  if(!result.record) throw new HttpError(404,"Nie znaleziono wpisu w wybranej bazie.");
  return result.record;
}
export async function saveRecord(table: string, token: string, input: unknown, userId: string, confirmResortStatus = false) {
  const spec=tableSchema(table), state=decode(token,table), before=state.records[state.source];
  if(!before) throw new HttpError(409,"Wpis nie istnieje w wybranej bazie. Odczytaj go ponownie.");
  const changes=validateChanges(spec,input,before);
  if (confirmResortStatus) {
    if (table !== "resorts" || !["otwarty", "zamknięty"].includes(String((input as Row).status))) throw new HttpError(400, "Nieprawidłowe potwierdzenie statusu ośrodka.");
    changes.last_checked_at = new Date().toISOString();
  } else if (table === "resorts" && "status" in changes) changes.last_checked_at = new Date().toISOString();
    if(!Object.keys(changes).length) return {record:before,revision:token,writes:[]};
  let mirror: ReturnType<typeof digitalOceanWriter> = null;
  let mirrorError: unknown;
  try { mirror = digitalOceanWriter(); } catch (error) { mirrorError = error; }
  const identity = Object.fromEntries(spec.keys.map(key => [key, before[key]]));
  const supabaseBefore=state.records.supabase, dropletBefore=state.records.droplet;
  const patch={...changes}; if("updated_at" in before) patch.updated_at=new Date().toISOString();
  const writeLocal = async () => {
    const db=adminClient();
    const {data:audit,error:auditError}=await db.from("admin_audit").insert({actor:userId,table_name:table,identity,before:supabaseBefore||before,changes,state:"prepared"}).select("id").single();
    if(auditError) dbFailure(auditError);
    if(!supabaseBefore) { await db.from("admin_audit").update({state:"conflict"}).eq("id",audit.id); throw new HttpError(409,"Wpis nie istnieje w Supabase."); }
    let q=db.from(table).update(patch);
    for(const [k,v] of Object.entries(supabaseBefore)) { if(v===null) q=q.is(k,null); else if(typeof v!=="object") q=q.eq(k,v); }
    const {data,error}=await q.select();
    if(error) { await db.from("admin_audit").update({state:"unverified"}).eq("id",audit.id); dbFailure(error); }
    if(data.length!==1) { await db.from("admin_audit").update({state:"conflict"}).eq("id",audit.id); throw new HttpError(409,"Wpis zmienił się w bazie. Odczytaj go ponownie."); }
    const current=await readRecord(table,identity);
    const verified=Object.entries(patch).every(([k,v])=>k==="updated_at" || (k==="last_checked_at" ? Number.isFinite(utcTimestamp(v)) && utcTimestamp(current[k])===utcTimestamp(v) : JSON.stringify(current[k])===JSON.stringify(v)));
    const {error:logError}=await db.from("admin_audit").update({state:verified?"verified":"unverified",after:current}).eq("id",audit.id);
    if(logError || !verified) throw new HttpError(502,"Zapis wysłany, ale potwierdzenie jest niepełne. Odczytaj wpis i sprawdź historię.");
    return current;
  };
    const [supabase, digitalOcean] = await Promise.allSettled([
      writeLocal(),
      mirror ? mirror(table, identity, dropletBefore, patch) : Promise.reject(mirrorError instanceof Error ? mirrorError : new Error("Brak konfiguracji zapisu na DigitalOcean.")),
    ]);
    const writes = [
      {database:"supabase" as const,ok:supabase.status==="fulfilled",message:supabase.status==="fulfilled"?"Zapis potwierdzony odczytem.":"Supabase nie potwierdził zapisu."},
      {database:"droplet" as const,ok:digitalOcean.status==="fulfilled",message:digitalOcean.status==="fulfilled"?"Zapis potwierdzony odczytem.":digitalOcean.reason instanceof Error?digitalOcean.reason.message:"Droplet nie potwierdził zapisu."},
    ];
    if (supabase.status === "rejected" && digitalOcean.status === "rejected") throw new HttpError(502, "Żadna baza nie potwierdziła zapisu. Sprawdź oba statusy baz przed ponowieniem.", "WRITE_UNCONFIRMED");
    const records:Record<DatabaseSource,Row|null>={
      supabase:supabase.status==="fulfilled"?supabase.value:supabaseBefore,
      droplet:digitalOcean.status==="fulfilled"?digitalOcean.value:dropletBefore,
    };
    const saved=records[state.source]||records[state.source==="supabase"?"droplet":"supabase"]||{...before,...patch};
    return {record:saved,revision:revisionFor(table,records,state.source),writes};
}


async function resortInventory(resortId: Row[string], source: DatabaseSource) {
  const [slopeRows,liftRows]=await Promise.all([listRecordsFrom("slopes",source),listRecordsFrom("lifts",source)]);
  const slopes=slopeRows.filter(row=>String(row.resort)===String(resortId));
  const lifts=liftRows.filter(row=>String(row.resort)===String(resortId));
  return { slopes, lifts };
}

// Bounded, resumable batches keep large resorts within the hosting request limit.
// Every child write uses the same audit, CAS and readback as the single-record editor.
export async function closeResortStep(token: string, userId: string) {
  const state=decode(token,"resorts"), before=state.records[state.source];
  if(!before) throw new HttpError(409,"Ośrodek nie istnieje w wybranej bazie.");
  const current = await readRecordFrom("resorts", { id: before.id },state.source);
  if (Object.entries(before).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))) throw new HttpError(409, "Ośrodek zmienił się w bazie. Odśwież dane przed zamknięciem.");
  const inventory = await resortInventory(before.id,state.source);
  const pending = (["slopes", "lifts"] as const).flatMap(table => inventory[table].filter(row => normalizeStatus(row.status) !== "closed").map(row => ({ table, row })));
  const writes = new Map<string, {database:"supabase"|"droplet";ok:boolean;message:string}>();
  function collect(receipts: {database:"supabase"|"droplet";ok:boolean;message:string}[] = []) {
    for(const receipt of receipts) {
      const previous=writes.get(receipt.database);
      writes.set(receipt.database,{...receipt,ok:receipt.ok && (previous?.ok ?? true),message:receipt.ok?(previous?.message ?? receipt.message):receipt.message});
    }
  }
  for (const { table, row } of pending.slice(0, 3)) {
    const pair=await readRecordBoth(table,{id:row.id});
    const records:Record<DatabaseSource,Row|null>={supabase:pair.supabase.ok?pair.supabase.record:null,droplet:pair.droplet.ok?pair.droplet.record:null};
    const selected=records[state.source];
    if(!selected||Object.entries(row).some(([key,value])=>JSON.stringify(selected[key])!==JSON.stringify(value))) throw new HttpError(409,"Trasa lub wyciąg zmieniły się podczas zamykania. Odśwież dane i ponów operację.");
    const rowRevision=revisionFor(table,records,state.source);
    const saved=await saveRecord(table,rowRevision,{status:"zamknięta"},userId);
    collect(saved.writes);
  }
  const after = await resortInventory(before.id,state.source);
  const remaining = [...after.slopes, ...after.lifts].filter(row => normalizeStatus(row.status) !== "closed").length;
  if (remaining) return { complete: false as const, remaining, inventory: after, writes:[...writes.values()] };
  // Confirm the resort only after every slope and lift has been read back as closed.
  const saved = await saveRecord("resorts", token, { status: "zamknięty" }, userId, true);
  collect(saved.writes);
  const verified = await resortInventory(before.id,state.source);
  if ([...verified.slopes, ...verified.lifts].some(row => normalizeStatus(row.status) !== "closed")) throw new HttpError(409, "Status obiektu zmienił się podczas zamykania. Odśwież bazę i ponów zamknięcie ośrodka.");
  return { ...saved, writes:[...writes.values()], complete: true as const, remaining: 0, inventory: verified };
}
