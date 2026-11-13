import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/admin/server";
import { tableSchema } from "@/lib/admin/schema";
import { recordIdentity } from "@/lib/admin/validation";
import { utcTimestamp } from "@/lib/skiAvailability";

export const runtime = "nodejs";

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
    const { table, identity, before, patch } = JSON.parse(raw);
    const spec = tableSchema(table);
    const keys = recordIdentity(spec, identity);
    const fields = Object.keys(patch);
    const allowed = new Set([...spec.fields.map(field => field.key), "updated_at"]);
    if (table === "resorts") allowed.add("last_checked_at");
    if (!fields.length || fields.some(key => !allowed.has(key) || spec.keys.includes(key) ||
      !Object.hasOwn(before, key) || (patch[key] !== null &&
        !["string", "number", "boolean"].includes(typeof patch[key])))) {
      return new Response(null, { status: 400 });
    }

    const db = adminClient();
    let read = db.from(table).select("*");
    for (const [key, value] of Object.entries(keys)) read = read.eq(key, value);
    const { data: current, error } = await read.single();
    if (error || !current) return new Response(null, { status: 409 });
    const changed = fields.filter(key => key !== "updated_at");
    if (changed.every(key => equal(key, current[key], patch[key]))) {
      return new Response(null, { status: 204 });
    }
    if (changed.some(key => !equal(key, current[key], before[key]) &&
      !equal(key, current[key], patch[key]))) {
      return new Response(null, { status: 409 });
    }

    let update = db.from(table).update(patch);
    for (const key of new Set([...Object.keys(keys), ...fields])) {
      update = current[key] === null ? update.is(key, null) : update.eq(key, current[key]);
    }
    const result = await update.select().single();
    const confirmed = !result.error && changed.every(key => equal(key, result.data[key], patch[key]));
    return new Response(null, { status: confirmed ? 204 : 409 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
