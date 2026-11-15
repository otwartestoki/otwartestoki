import { digitalOceanRead } from "@/lib/admin/digitalocean";

export const runtime = "nodejs";

const SEARCH_KEYS = new Set([
  "p_q", "p_status", "p_difficulty", "p_kids_tape", "p_sort", "p_region",
  "p_country", "p_min_open_km", "p_limit", "p_offset",
]);

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 12000) return new Response(null, { status: 413 });
    const body = JSON.parse(raw);
    if (body?.action === "search") {
      const params = body.params;
      if (!params || typeof params !== "object" || Array.isArray(params) ||
          Object.keys(params).some(key => !SEARCH_KEYS.has(key)) ||
          Object.values(params).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value)) ||
          (params.p_limit !== undefined && (!Number.isInteger(params.p_limit) || params.p_limit < 1 || params.p_limit > 2000))) {
        return new Response(null, { status: 400 });
      }
    } else if (body?.action === "resort-detail") {
      if (typeof body.id !== "string" && typeof body.id !== "number") return new Response(null, { status: 400 });
      if (!/^(?:\d{1,12}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(String(body.id))) return new Response(null, { status: 400 });
    } else if (!["updated-at", "slopes-inventory"].includes(body?.action)) {
      return new Response(null, { status: 400 });
    }
    const data = await digitalOceanRead<{ data: unknown }>({ operation: "public", action: body.action, params: body.params, id: body.id });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(JSON.stringify({ error: "Public data is temporarily unavailable." }), {
      status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
