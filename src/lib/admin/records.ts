import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient, dbFailure } from "./server";
import { tableSchema } from "./schema";
import { HttpError, normalizeStatus, recordIdentity, validateChanges } from "./validation";
import type { Row } from "./types";
import { utcTimestamp } from "../skiAvailability";

function secret() { const s = process.env.ADMIN_REVISION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; if (!s) throw new HttpError(503,"Brak konfiguracji serwera."); return s; }
function signature(s: string) { return createHmac("sha256",secret()).update(s).digest("base64url"); }
export function revision(table: string, row: Row) { const payload = Buffer.from(JSON.stringify({table,row,expires:Date.now()+3600000})).toString("base64url"); return payload+"."+signature(payload); }
function decode(token: string, table: string): Row {
  const [p,s] = token.split("."); const expected = signature(p || "");
  if (!s || s.length !== expected.length || !timingSafeEqual(Buffer.from(s),Buffer.from(expected))) throw new HttpError(400,"Nieprawidłowa wersja wpisu.");
  try { const data=JSON.parse(Buffer.from(p,"base64url").toString()); if(data.table!==table || data.expires<Date.now()) throw Error(); return data.row; } catch { throw new HttpError(409,"Odczytaj wpis ponownie: wersja wygasła."); }
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
export async function saveRecord(table: string, token: string, input: unknown, userId: string, confirmResortStatus = false) {
  const spec=tableSchema(table), before=decode(token,table), changes=validateChanges(spec,input,before);
  if (confirmResortStatus) {
    if (table !== "resorts" || !["otwarty", "zamknięty"].includes(String((input as Row).status))) throw new HttpError(400, "Nieprawidłowe potwierdzenie statusu ośrodka.");
    changes.last_checked_at = new Date().toISOString();
  } else if (table === "resorts" && "status" in changes) changes.last_checked_at = new Date().toISOString();
  if(!Object.keys(changes).length) return {record:before,revision:revision(table,before)};
  const db=adminClient(); const {data:audit,error:auditError}=await db.from("admin_audit").insert({actor:userId,table_name:table,identity:Object.fromEntries(spec.keys.map(k=>[k,before[k]])),before,changes,state:"prepared"}).select("id").single(); if(auditError) dbFailure(auditError);
  const patch={...changes}; if("updated_at" in before) patch.updated_at=new Date().toISOString();
  let q=db.from(table).update(patch);
  for(const [k,v] of Object.entries(before)) { if(v===null) q=q.is(k,null); else if(typeof v!=="object") q=q.eq(k,v); }
  const {data,error}=await q.select();
  if(error) { await db.from("admin_audit").update({state:"unverified"}).eq("id",audit.id); dbFailure(error); }
  if(data.length!==1) { await db.from("admin_audit").update({state:"conflict"}).eq("id",audit.id); throw new HttpError(409,"Wpis zmienił się w bazie. Odczytaj go ponownie."); }
  const current=await readRecord(table,Object.fromEntries(spec.keys.map(k=>[k,before[k]])));
  const verified=Object.entries(patch).every(([k,v])=>k==="updated_at" || (k==="last_checked_at" ? Number.isFinite(utcTimestamp(v)) && utcTimestamp(current[k])===utcTimestamp(v) : JSON.stringify(current[k])===JSON.stringify(v)));
  const {error:logError}=await db.from("admin_audit").update({state:verified?"verified":"unverified",after:current}).eq("id",audit.id);
  if(logError || !verified) throw new HttpError(502,"Zapis wysłany, ale potwierdzenie jest niepełne. Odczytaj wpis i sprawdź historię.");
  return {record:current,revision:revision(table,current)};
}


async function resortInventory(resortId: Row[string]) {
  async function rows(table: "slopes" | "lifts") {
    const all: Row[] = [];
    for (let start = 0; start < 10000; start += 500) {
      const { data, error } = await adminClient().from(table).select("*").eq("resort", resortId).order("id").range(start, start + 499);
      if (error) dbFailure(error);
      all.push(...data);
      if (data.length < 500) return all;
    }
    throw new HttpError(413, "Zbyt wiele obiektów ośrodka.");
  }
  const [slopes, lifts] = await Promise.all([rows("slopes"), rows("lifts")]);
  return { slopes, lifts };
}

// Bounded, resumable batches keep large resorts within the hosting request limit.
// Every child write uses the same audit, CAS and readback as the single-record editor.
export async function closeResortStep(token: string, userId: string) {
  const before = decode(token, "resorts");
  const current = await readRecord("resorts", { id: before.id });
  if (Object.entries(before).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))) throw new HttpError(409, "Ośrodek zmienił się w bazie. Odśwież dane przed zamknięciem.");
  const inventory = await resortInventory(before.id);
  const pending = (["slopes", "lifts"] as const).flatMap(table => inventory[table].filter(row => normalizeStatus(row.status) !== "closed").map(row => ({ table, row })));
  for (const { table, row } of pending.slice(0, 3)) await saveRecord(table, revision(table, row), { status: "zamknięta" }, userId);
  const after = await resortInventory(before.id);
  const remaining = [...after.slopes, ...after.lifts].filter(row => normalizeStatus(row.status) !== "closed").length;
  if (remaining) return { complete: false as const, remaining, inventory: after };
  // Confirm the resort only after every slope and lift has been read back as closed.
  const saved = await saveRecord("resorts", token, { status: "zamknięty" }, userId, true);
  const verified = await resortInventory(before.id);
  if ([...verified.slopes, ...verified.lifts].some(row => normalizeStatus(row.status) !== "closed")) throw new HttpError(409, "Status obiektu zmienił się podczas zamykania. Odśwież bazę i ponów zamknięcie ośrodka.");
  return { ...saved, complete: true as const, remaining: 0, inventory: verified };
}
