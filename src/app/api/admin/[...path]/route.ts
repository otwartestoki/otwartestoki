import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient, assertAllowed, authClient, dbFailure, logoutResponse, REFRESH_COOKIE, requireAdmin, sameOrigin, sessionResponse } from "@/lib/admin/server";
import { closeResortStep, listRecordsBoth, readRecordBoth, readRecordFrom, revisionFor, saveRecord } from "@/lib/admin/records";
import { HttpError, normalizeStatus } from "@/lib/admin/validation";
import type { DatabaseSource, Row } from "@/lib/admin/types";
import { checkSource, databaseSnapshot } from "@/lib/admin/collector";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
async function handle(request: NextRequest, context: {params:Promise<{path:string[]}>}) {
  try {
    const path=(await context.params).path.join("/");
    if(request.method==="POST") sameOrigin(request);
    if(Number(request.headers.get("content-length")||0)>100000) throw new HttpError(413,"Zbyt duże żądanie.");
    const body=request.method==="POST" ? await request.json().catch(()=>{throw new HttpError(400,"Nieprawidłowe dane.");}) : {};
    if(JSON.stringify(body).length>100000) throw new HttpError(413,"Zbyt duże żądanie.");
    if(path==="login" && request.method==="POST") {
      if(typeof body.email!=="string" || typeof body.password!=="string" || body.password.length>1000) throw new HttpError(400,"Podaj e-mail i hasło.");
      const {data,error}=await authClient().auth.signInWithPassword({email:body.email,password:body.password});
      if(error || !data.user || !data.session) throw new HttpError(401,"Nieprawidłowy e-mail lub hasło.");
      assertAllowed(data.user); return sessionResponse(data.session);
    }
    if(path==="logout" && request.method==="POST") return logoutResponse();
    if(path==="refresh" && request.method==="POST") {
      const token=(await cookies()).get(REFRESH_COOKIE)?.value;
      if(!token) throw new HttpError(401,"Zaloguj się ponownie.");
      const {data,error}=await authClient().auth.refreshSession({refresh_token:token});
      if(error || !data.user || !data.session) throw new HttpError(401,"Zaloguj się ponownie.");
      assertAllowed(data.user); return sessionResponse(data.session);
    }
    const user=await requireAdmin(); let result:unknown;
    if(path==="me" && request.method==="GET") result={email:user.email};
    else if(path==="snapshot" && request.method==="GET") {
      const selected=request.nextUrl.searchParams.get("database");
      if(selected!=="supabase"&&selected!=="droplet") throw new HttpError(400,"Wybierz bazę do obliczania propozycji.");
      result=await databaseSnapshot(selected);
    }
    else if(path==="check-source" && request.method==="POST") result=await checkSource(body.source_id);
    else if(path==="records" && request.method==="GET") {
      const databases=await listRecordsBoth(request.nextUrl.searchParams.get("table")||"");
      result={rows:databases.supabase.ok?databases.supabase.rows:[],databases};
    }
    else if(path==="record" && request.method==="POST") {
      if(body.database!=="supabase"&&body.database!=="droplet") throw new HttpError(400,"Wybierz bazę do odczytu wpisu.");
      const databases=await readRecordBoth(body.table,body.identity);
      const source=body.database as DatabaseSource;
      const selected=databases[source], row=selected.ok?selected.record:null;
      const records:Record<DatabaseSource,Row|null>={supabase:databases.supabase.ok?databases.supabase.record:null,droplet:databases.droplet.ok?databases.droplet.record:null};
      result={record:row,revision:row?revisionFor(body.table,records,source):null,database:source,databases};
    }
    else if(path==="save" && request.method==="POST") result=await saveRecord(body.table,String(body.revision||""),body.changes,user.id);
    else if(path==="confirm-resort" && request.method==="POST") result=body.status === "zamknięty" ? await closeResortStep(String(body.revision||""),user.id) : await saveRecord("resorts",String(body.revision||""),{status:body.status},user.id,true);
    else if(path==="proposal" && request.method==="POST") {
      if(!["slopes","lifts"].includes(body.table) || !["open","closed"].includes(body.target)) throw new HttpError(400,"Nieprawidłowa propozycja.");
      if(body.database!=="supabase"&&body.database!=="droplet") throw new HttpError(400,"Wybierz bazę, z której wyliczono propozycję.");
      const source=body.database as DatabaseSource;
      const row=await readRecordFrom(body.table,{id:body.id},source);
      if(String(row.resort)!==String(body.resort)) throw new HttpError(409,"Propozycja dotyczy innego ośrodka.");
      if(normalizeStatus(row.status)===body.target) result={record:row,message:"W bazie jest już ten status."};
      else {
        if(row.status!==body.before || String(row.updated_at??"")!==String(body.updated_at??"")) throw new HttpError(409,"Stan bazy różni się od raportu. Odczytaj wpis w edytorze.");
        const databases=await readRecordBoth(body.table,{id:body.id});
        const records:Record<DatabaseSource,Row|null>={supabase:databases.supabase.ok?databases.supabase.record:null,droplet:databases.droplet.ok?databases.droplet.record:null};
        const selected=records[source];
        if(!selected||Object.entries(row).some(([key,value])=>JSON.stringify(selected[key])!==JSON.stringify(value))) throw new HttpError(409,"Wybrana baza zmieniła się podczas zapisu. Odczytaj ją ponownie.");
        result=await saveRecord(body.table,revisionFor(body.table,records,source),{status:body.target==="open"?"otwarta":"zamknięta"},user.id);
      }
    }
    else if(path==="history" && request.method==="GET") { const {data,error}=await adminClient().from("admin_audit").select("*").order("created_at",{ascending:false}).limit(200); if(error) dbFailure(error); result={rows:data}; }
    else throw new HttpError(404,"Nie znaleziono operacji.");
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { const e=error instanceof HttpError?error:new HttpError(500,"Nie udało się zakończyć operacji. Odczytaj aktualny stan przed ponowieniem."); return NextResponse.json({error:e.message,code:e.code},{status:e.status,headers:{"Cache-Control":"private, no-store"}}); }
}
export const GET=handle;
export const POST=handle;
