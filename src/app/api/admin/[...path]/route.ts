import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminClient, assertAllowed, authClient, dbFailure, logoutResponse, REFRESH_COOKIE, requireAdmin, sameOrigin, sessionResponse } from "@/lib/admin/server";
import { listRecords, readRecord, revision, saveRecord } from "@/lib/admin/records";
import { HttpError, normalizeStatus } from "@/lib/admin/validation";
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
    else if(path==="records" && request.method==="GET") result={rows:await listRecords(request.nextUrl.searchParams.get("table")||"")};
    else if(path==="record" && request.method==="POST") { const row=await readRecord(body.table,body.identity); result={record:row,revision:revision(body.table,row)}; }
    else if(path==="save" && request.method==="POST") result=await saveRecord(body.table,String(body.revision||""),body.changes,user.id);
    else if(path==="proposal" && request.method==="POST") {
      if(!["slopes","lifts"].includes(body.table) || !["open","closed"].includes(body.target)) throw new HttpError(400,"Nieprawidłowa propozycja.");
      const row=await readRecord(body.table,{id:body.id});
      if(String(row.resort)!==String(body.resort)) throw new HttpError(409,"Propozycja dotyczy innego ośrodka.");
      if(normalizeStatus(row.status)===body.target) result={record:row,message:"W bazie jest już ten status."};
      else {
        if(row.status!==body.before || String(row.updated_at??"")!==String(body.updated_at??"")) throw new HttpError(409,"Stan bazy różni się od raportu. Odczytaj wpis w edytorze.");
        result=await saveRecord(body.table,revision(body.table,row),{status:body.target==="open"?"otwarta":"zamknięta"},user.id);
      }
    }
    else if(path==="history" && request.method==="GET") { const {data,error}=await adminClient().from("admin_audit").select("*").order("created_at",{ascending:false}).limit(200); if(error) dbFailure(error); result={rows:data}; }
    else throw new HttpError(404,"Nie znaleziono operacji.");
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { const e=error instanceof HttpError?error:new HttpError(500,"Nie udało się zakończyć operacji. Odczytaj aktualny stan przed ponowieniem."); return NextResponse.json({error:e.message,code:e.code},{status:e.status,headers:{"Cache-Control":"private, no-store"}}); }
}
export const GET=handle;
export const POST=handle;
