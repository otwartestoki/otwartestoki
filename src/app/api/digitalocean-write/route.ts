import { timingSafeEqual } from "node:crypto";
import { adminClient, assertAllowed, authClient } from "@/lib/admin/server";
import { tableSchema } from "@/lib/admin/schema";
import { recordIdentity } from "@/lib/admin/validation";
import { utcTimestamp } from "@/lib/skiAvailability";

export const runtime = "nodejs";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function omitFields<T extends Record<string, unknown>>(row:T,...keys:string[]) { const copy={...row}; for(const key of keys) delete copy[key]; return copy; }

async function logSkipassAction(db: ReturnType<typeof adminClient>, actor: string, table: string, identity: Record<string, unknown>, before: unknown, changes: Record<string, unknown>) {
  const { data, error } = await db.from("admin_audit").insert({ actor, table_name: table, identity, before, changes, state: "prepared" }).select("id").single();
  if (error || !data) throw new Error("Nie udało się zapisać operacji w historii.");
  return data.id as string;
}

async function skipassAdmin(db: ReturnType<typeof adminClient>, payload: Record<string, unknown>) {
  const actor=typeof payload.actor==="string"&&UUID_RE.test(payload.actor)?payload.actor:null;
  if(!actor) return new Response(null,{status:400});

  if(payload.action==="add-product") {
    const name=String(payload.name??"").trim(),season=String(payload.season_label??"").trim();
    if(!name||name.length>200||!season||season.length>40) return new Response(null,{status:400});
    const row={id:crypto.randomUUID(),name,provider:typeof payload.provider==="string"?payload.provider.trim().slice(0,200)||null:null,pass_type:typeof payload.pass_type==="string"?payload.pass_type.trim().slice(0,120)||null:null,currency:"PLN",url:null,season_label:season,notes:null,last_checked_at:null};
    const auditId=await logSkipassAction(db,actor,"skipass_products",{id:row.id},null,{created:row});
    const inserted=await db.from("skipass_products").insert(row).select("*").single();
    if(inserted.error||!inserted.data) { await db.from("admin_audit").update({state:"unverified"}).eq("id",auditId); return new Response(null,{status:502}); }
    await db.from("admin_audit").update({state:"verified",after:inserted.data}).eq("id",auditId);
    return Response.json({product:inserted.data});
  }

  if(payload.action==="copy-season") {
    const sourceId=String(payload.source_product_id??"");
    const season=String(payload.target_season??"").trim();
    if(!UUID_RE.test(sourceId)||!season||season.length>40) return new Response(null,{status:400});
    const {data:source,error:sourceError}=await db.from("skipass_products").select("*").eq("id",sourceId).maybeSingle();
    if(sourceError||!source) return new Response(null,{status:404});
    let dupeQuery=db.from("skipass_products").select("id").eq("name",source.name).eq("season_label",season);
    dupeQuery=source.provider==null?dupeQuery.is("provider",null):dupeQuery.eq("provider",source.provider);
    dupeQuery=source.pass_type==null?dupeQuery.is("pass_type",null):dupeQuery.eq("pass_type",source.pass_type);
    const {data:dupe,error:dupeError}=await dupeQuery.limit(1);
    if(dupeError) return new Response(null,{status:502});
    if(dupe?.length) return new Response(null,{status:409});
    const [coverageRead,priceRead]=await Promise.all([
      db.from("skipass_coverage").select("*").eq("skipass_product_id",sourceId),
      db.from("skipass_prices").select("*").eq("skipass_product_id",sourceId),
    ]);
    if(coverageRead.error||priceRead.error) return new Response(null,{status:502});
    const id=crypto.randomUUID();
    const productFields=omitFields(source,"created_at","last_checked_at");
    const product={...productFields,id,season_label:season,last_checked_at:null};
    const newCoverage=(coverageRead.data??[]).map((row:Record<string,unknown>)=>({...omitFields(row,"created_at"),skipass_product_id:id}));
    // Carry over variants as empty, undated drafts so last season's prices never appear as current.
    const newPrices=(priceRead.data??[]).map((row:Record<string,unknown>)=>({...omitFields(row,"created_at"),id:crypto.randomUUID(),skipass_product_id:id,price:null,valid_from:null,valid_to:null,last_checked_at:null}));
    const auditId=await logSkipassAction(db,actor,"skipass_products",{id},null,{copied_from:sourceId,source_season:source.season_label,target_season:season,copied_coverage:newCoverage.length,price_drafts:newPrices.length});
    let productCreated=false;
    try {
      const inserted=await db.from("skipass_products").insert(product).select("*").single();
      if(inserted.error||!inserted.data) throw new Error("product insert failed");
      productCreated=true;
      if(newCoverage.length) { const result=await db.from("skipass_coverage").insert(newCoverage); if(result.error) throw new Error("coverage insert failed"); }
      if(newPrices.length) { const result=await db.from("skipass_prices").insert(newPrices); if(result.error) throw new Error("price insert failed"); }
      const [{data:verifyProduct,error:verifyProductError},{count:coverageCount,error:coverageError},{count:priceCount,error:priceError}]=await Promise.all([
        db.from("skipass_products").select("id").eq("id",id).maybeSingle(),
        db.from("skipass_coverage").select("resort_id",{count:"exact",head:true}).eq("skipass_product_id",id),
        db.from("skipass_prices").select("id",{count:"exact",head:true}).eq("skipass_product_id",id),
      ]);
      const verified=!!verifyProduct&&!verifyProductError&&!coverageError&&!priceError&&coverageCount===newCoverage.length&&priceCount===newPrices.length;
      await db.from("admin_audit").update({state:verified?"verified":"unverified",after:{id,season_label:season,coverage_count:coverageCount,price_draft_count:priceCount}}).eq("id",auditId);
      if(!verified) throw new Error("copy readback failed");
      return Response.json({product:inserted.data,coverage_count:coverageCount,price_draft_count:priceCount});
    } catch {
      if(productCreated) {
        await db.from("skipass_prices").delete().eq("skipass_product_id",id);
        await db.from("skipass_coverage").delete().eq("skipass_product_id",id);
        await db.from("skipass_products").delete().eq("id",id);
      }
      await db.from("admin_audit").update({state:"unverified"}).eq("id",auditId);
      return new Response(null,{status:502});
    }
  }

  if(payload.action==="add-price") {
    const productId=String(payload.skipass_product_id??"");
    if(!UUID_RE.test(productId)) return new Response(null,{status:400});
    const {data:product,error:productError}=await db.from("skipass_products").select("id").eq("id",productId).maybeSingle();
    if(productError||!product) return new Response(null,{status:404});
    const row={id:crypto.randomUUID(),skipass_product_id:productId,category:"Dorośli",duration_value:1,duration_unit:"day",price:null,price_type:null,day_type:null,valid_from:null,valid_to:null,source_url:null,last_checked_at:null};
    const auditId=await logSkipassAction(db,actor,"skipass_prices",{id:row.id},null,{skipass_product_id:productId,created_as_empty_draft:true});
    const inserted=await db.from("skipass_prices").insert(row).select("*").single();
    if(inserted.error||!inserted.data) { await db.from("admin_audit").update({state:"unverified"}).eq("id",auditId); return new Response(null,{status:502}); }
    await db.from("admin_audit").update({state:"verified",after:inserted.data}).eq("id",auditId);
    return Response.json({record:inserted.data});
  }

  if(payload.action==="add-coverage") {
    const productId=String(payload.skipass_product_id??""),rawResortId=String(payload.resort_id??"");
    if(!UUID_RE.test(productId)||!rawResortId||rawResortId.length>200) return new Response(null,{status:400});
    const resortId=/^\d+$/.test(rawResortId)?Number(rawResortId):rawResortId;
    const [{data:product},{data:resort},{data:existing}]=await Promise.all([
      db.from("skipass_products").select("id").eq("id",productId).maybeSingle(),
      db.from("resorts").select("id").eq("id",resortId).maybeSingle(),
      db.from("skipass_coverage").select("resort_id").eq("skipass_product_id",productId).eq("resort_id",resortId).maybeSingle(),
    ]);
    if(!product||!resort) return new Response(null,{status:404});
    if(existing) return new Response(null,{status:409});
    const row={skipass_product_id:productId,resort_id:resortId,coverage_type:typeof payload.coverage_type==="string"?payload.coverage_type:"regional",notes:null};
    const auditId=await logSkipassAction(db,actor,"skipass_coverage",{skipass_product_id:productId,resort_id:resortId},null,row);
    const inserted=await db.from("skipass_coverage").insert(row).select("*").single();
    if(inserted.error||!inserted.data) { await db.from("admin_audit").update({state:"unverified"}).eq("id",auditId); return new Response(null,{status:502}); }
    await db.from("admin_audit").update({state:"verified",after:inserted.data}).eq("id",auditId);
    return Response.json({record:inserted.data});
  }

  if(payload.action==="remove-coverage") {
    const productId=String(payload.skipass_product_id??""),rawResortId=String(payload.resort_id??"");
    if(!UUID_RE.test(productId)||!rawResortId||rawResortId.length>200) return new Response(null,{status:400});
    const resortId=/^\d+$/.test(rawResortId)?Number(rawResortId):rawResortId;
    const {data:before,error:readError}=await db.from("skipass_coverage").select("*").eq("skipass_product_id",productId).eq("resort_id",resortId).maybeSingle();
    if(readError||!before) return new Response(null,{status:404});
    const auditId=await logSkipassAction(db,actor,"skipass_coverage",{skipass_product_id:productId,resort_id:resortId},before,{removed:true});
    const result=await db.from("skipass_coverage").delete().eq("skipass_product_id",productId).eq("resort_id",resortId).select("resort_id");
    if(result.error||!result.data?.length) { await db.from("admin_audit").update({state:"unverified"}).eq("id",auditId); return new Response(null,{status:502}); }
    const verify=await db.from("skipass_coverage").select("resort_id").eq("skipass_product_id",productId).eq("resort_id",resortId).maybeSingle();
    const verified=!verify.error&&!verify.data;
    await db.from("admin_audit").update({state:verified?"verified":"unverified",after:null}).eq("id",auditId);
    return verified?Response.json({removed:true}):new Response(null,{status:502});
  }

  return new Response(null,{status:400});
}

function equal(key: string, left: unknown, right: unknown) {
  if (typeof left === "string" && typeof right === "string" &&
      ["updated_at", "last_checked_at"].includes(key)) {
    return utcTimestamp(left) === utcTimestamp(right);
  }
  return left === right;
}

export async function POST(request: Request) {
  const token = process.env.ADMIN_DIGITALOCEAN_RECEIVE_TOKEN;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (!token || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return new Response(null, { status: 401 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 100000) return new Response(null, { status: 413 });
    const payload = JSON.parse(raw);
    const db = adminClient();
    if (payload.operation === "auth") {
      if (payload.action === "login") {
        if (typeof payload.email !== "string" || typeof payload.password !== "string" || payload.password.length > 1000) return new Response(null, { status: 400 });
        const { data, error } = await authClient().auth.signInWithPassword({ email: payload.email, password: payload.password });
        if (error || !data.user || !data.session) return new Response(null, { status: 401 });
        assertAllowed(data.user);
        return Response.json({ user: data.user, session: data.session }, { headers: { "Cache-Control": "no-store" } });
      }
      if (payload.action === "refresh") {
        if (typeof payload.refresh_token !== "string" || payload.refresh_token.length > 10000) return new Response(null, { status: 400 });
        const { data, error } = await authClient().auth.refreshSession({ refresh_token: payload.refresh_token });
        if (error || !data.user || !data.session) return new Response(null, { status: 401 });
        assertAllowed(data.user);
        return Response.json({ user: data.user, session: data.session }, { headers: { "Cache-Control": "no-store" } });
      }
      if (payload.action === "get-user") {
        if (typeof payload.access_token !== "string" || payload.access_token.length > 10000) return new Response(null, { status: 400 });
        const { data, error } = await authClient().auth.getUser(payload.access_token);
        if (error || !data.user) return new Response(null, { status: 401 });
        assertAllowed(data.user);
        return Response.json({ user: data.user }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response(null, { status: 400 });
    }
    if (payload.operation === "read" && payload.action === "history") {
      const { data, error } = await db.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) return new Response(null, { status: 502 });
      return Response.json({ rows: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if(payload.operation==="skipass-admin") return await skipassAdmin(db,payload);
    if (payload.operation === "public") {
      const action = payload.action;
      if (action === "updated-at") {
        const { data, error } = await db.from("resorts_public_list").select("resort_updated_at")
          .not("resort_updated_at", "is", null).order("resort_updated_at", { ascending: false }).limit(1);
        if (error) return new Response(null, { status: 502 });
        return Response.json({ data: data?.[0]?.resort_updated_at ?? null }, { headers: { "Cache-Control": "no-store" } });
      }
      if (action === "search") {
        if (!payload.params || typeof payload.params !== "object") return new Response(null, { status: 400 });
        const { data, error } = await db.rpc("resorts_public_list_search_v3", payload.params);
        if (error) return new Response(null, { status: 502 });
        return Response.json({ data: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
      }
      if (action === "slopes-inventory") {
        const rows = [];
        for (let start = 0; start < 50000; start += 1000) {
          const { data, error } = await db.from("slopes").select("id,resort,status").order("id").range(start, start + 999);
          if (error) return new Response(null, { status: 502 });
          rows.push(...data);
          if (data.length < 1000) return Response.json({ data: rows }, { headers: { "Cache-Control": "no-store" } });
        }
        return new Response(null, { status: 413 });
      }
      if (action === "resort-detail") {
        const id = String(payload.id ?? "");
        if (!/^(?:\d{1,12}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id)) return new Response(null, { status: 400 });
        const [pub, base, slopes, lifts, coverage] = await Promise.all([
          db.from("resorts_public_list").select("id,name,region,city,country,resort_updated_at,resort_stats(slopes_open,slopes_total,open_km,total_km,lifts_open,lifts_total,skipass_price,skipass_currency,skipass_url,skipass_label,stats_updated_at)").eq("id", id).maybeSingle(),
          db.from("resorts").select("id,url,trail_map_url,webcam_url").eq("id", id).maybeSingle(),
          db.from("slopes").select("id,number,resort,sector,name,difficulty,length_m,snow,light,status,updated_at").eq("resort", id).order("number"),
          db.from("lifts").select("id,resort,number,name,type,seats,capacity_pph,length_m,status,updated_at").eq("resort", id).order("number"),
          db.from("skipass_coverage").select("resort_id,skipass_product_id,coverage_type,notes,created_at,skipass_products(id,name,provider,pass_type,currency,notes,url,season_label,last_checked_at,created_at)").eq("resort_id", id),
        ]);
        if (pub.error || base.error || slopes.error || lifts.error || coverage.error) return new Response(null, { status: 502 });
        const productIds = [...new Set((coverage.data ?? []).map(row => row.skipass_product_id).filter(Boolean))];
        let prices: unknown[] = [];
        if (productIds.length) {
          const result = await db.from("skipass_prices").select("id,skipass_product_id,category,duration_value,duration_unit,price,price_type,day_type,valid_from,valid_to,source_url,last_checked_at,created_at").in("skipass_product_id", productIds).not("price", "is", null);
          if (result.error) return new Response(null, { status: 502 });
          prices = result.data ?? [];
        }
        return Response.json({ data: { resort: pub.data ? { ...pub.data, ...(base.data ?? {}) } : null, slopes: slopes.data ?? [], lifts: lifts.data ?? [], coverage: coverage.data ?? [], prices } }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response(null, { status: 400 });
    }
    const { table } = payload;
    const spec = tableSchema(table);
    if (payload.operation === "read") {
      if (payload.action === "list") {
        const rows = [];
        for (let start = 0; start < 10000; start += 500) {
          const { data, error } = await db.from(table).select("*").order(spec.keys[0]).range(start, start + 499);
          if (error) return new Response(null, { status: 502 });
          rows.push(...data);
          if (data.length < 500) return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
        }
        return new Response(null, { status: 413 });
      }
      if (payload.action === "record") {
        const keys = recordIdentity(spec, payload.identity);
        let read = db.from(table).select("*");
        for (const [key, value] of Object.entries(keys)) read = read.eq(key, value);
        const { data, error } = await read.maybeSingle();
        if (error) return new Response(null, { status: 502 });
        return Response.json({ record: data }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response(null, { status: 400 });
    }
    const { identity, before, patch } = payload;
    const keys = recordIdentity(spec, identity);
    if (!before || typeof before !== "object") return new Response(null, { status: 409 });
    const fields = Object.keys(patch);
    const allowed = new Set([...spec.fields.map(field => field.key), "updated_at"]);
    if (table === "resorts") allowed.add("last_checked_at");
    if (!fields.length || fields.some(key => !allowed.has(key) || spec.keys.includes(key) ||
      !Object.hasOwn(before, key) || (patch[key] !== null &&
        !["string", "number", "boolean"].includes(typeof patch[key])))) {
      return new Response(null, { status: 400 });
    }

    let read = db.from(table).select("*");
    for (const [key, value] of Object.entries(keys)) read = read.eq(key, value);
    const { data: current, error } = await read.single();
    if (error || !current) return new Response(null, { status: 409 });
    const changed = fields.filter(key => key !== "updated_at");
    if (changed.every(key => equal(key, current[key], patch[key]))) {
      return Response.json({ record: current }, { headers: { "Cache-Control": "no-store" } });
    }
    if (changed.some(key => !equal(key, current[key], before[key]) &&
      !equal(key, current[key], patch[key]))) {
      return new Response(null, { status: 409 });
    }

    const actor = typeof payload.actor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.actor) ? payload.actor : null;
    let auditId: string | null = null;
    if (actor) {
      const { data: audit, error: auditError } = await db.from("admin_audit").insert({ actor, table_name: table, identity: keys, before: current, changes: patch, state: "prepared" }).select("id").single();
      if (auditError || !audit) return new Response(null, { status: 502 });
      auditId = audit.id;
    }

    let update = db.from(table).update(patch);
    for (const key of new Set([...Object.keys(keys), ...fields])) {
      update = current[key] === null ? update.is(key, null) : update.eq(key, current[key]);
    }
    const result = await update.select().single();
    const confirmed = !result.error && changed.every(key => equal(key, result.data[key], patch[key]));
    if (auditId) {
      const { error: auditError } = await db.from("admin_audit").update({ state: confirmed ? "verified" : result.error ? "unverified" : "conflict", after: result.data ?? null }).eq("id", auditId);
      if (auditError && confirmed) await db.from("admin_audit").update({ state: "unverified", after: result.data }).eq("id", auditId);
    }
    return confirmed
      ? Response.json({ record: result.data }, { headers: { "Cache-Control": "no-store" } })
      : new Response(null, { status: 409 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
