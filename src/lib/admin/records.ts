import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient, dbFailure } from "./server";
import { tableSchema } from "./schema";
import { HttpError, recordIdentity, validateChanges } from "./validation";
import type { Row } from "./types";

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
export async function saveRecord(table: string, token: string, input: unknown, userId: string) {
  const spec=tableSchema(table), before=decode(token,table), changes=validateChanges(spec,input,before);
  if(!Object.keys(changes).length) return {record:before,revision:revision(table,before)};
  const db=adminClient(); const {data:audit,error:auditError}=await db.from("admin_audit").insert({actor:userId,table_name:table,identity:Object.fromEntries(spec.keys.map(k=>[k,before[k]])),before,changes,state:"prepared"}).select("id").single(); if(auditError) dbFailure(auditError);
  const patch={...changes}; if("updated_at" in before) patch.updated_at=new Date().toISOString();
  let q=db.from(table).update(patch);
  for(const [k,v] of Object.entries(before)) { if(v===null) q=q.is(k,null); else if(typeof v!=="object") q=q.eq(k,v); }
  const {data,error}=await q.select();
  if(error) { await db.from("admin_audit").update({state:"unverified"}).eq("id",audit.id); dbFailure(error); }
  if(data.length!==1) { await db.from("admin_audit").update({state:"conflict"}).eq("id",audit.id); throw new HttpError(409,"Wpis zmienił się w bazie. Odczytaj go ponownie."); }
  const current=await readRecord(table,Object.fromEntries(spec.keys.map(k=>[k,before[k]])));
  const verified=Object.entries(patch).every(([k,v])=>k==="updated_at" || JSON.stringify(current[k])===JSON.stringify(v));
  const {error:logError}=await db.from("admin_audit").update({state:verified?"verified":"unverified",after:current}).eq("id",audit.id);
  if(logError || !verified) throw new HttpError(502,"Zapis wysłany, ale potwierdzenie jest niepełne. Odczytaj wpis i sprawdź historię.");
  return {record:current,revision:revision(table,current)};
}
