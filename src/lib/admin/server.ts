import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { allowlisted, HttpError } from "./validation";

export const ACCESS_COOKIE = "os_admin_access";
export const REFRESH_COOKIE = "os_admin_refresh";
export function publicConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(503, "Panel wymaga konfiguracji połączenia Supabase na Vercel.", "CONFIG_REQUIRED");
  return { url, key };
}
export function authClient() { const { url, key } = publicConfig(); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }); }
export function adminClient() {
  const { url } = publicConfig();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpError(503, "Brak serwerowego klucza Supabase w ustawieniach Vercel.", "CONFIG_REQUIRED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function assertAllowed(user: User) {
  if (!process.env.ADMIN_EMAILS) throw new HttpError(503, "Brak listy administratorów ADMIN_EMAILS.", "CONFIG_REQUIRED");
  if (!allowlisted(user.email, Boolean(user.email_confirmed_at), process.env.ADMIN_EMAILS)) throw new HttpError(403, "To konto nie ma dostępu do panelu.", "FORBIDDEN");
}
export async function requireAdmin(): Promise<User> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new HttpError(401, "Zaloguj się ponownie.", "UNAUTHORIZED");
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sesja wygasła. Zaloguj się ponownie.", "UNAUTHORIZED");
  assertAllowed(data.user);
  return data.user;
}
export function sameOrigin(request: NextRequest) {
  const origin=request.headers.get("origin");
  let valid=false;
  try {const url=new URL(origin||"");valid=url.host===request.headers.get("host") && (url.protocol==="https:" || (process.env.NODE_ENV!=="production" && url.protocol==="http:") || (url.protocol==="http:" && ["127.0.0.1","localhost"].includes(url.hostname)));} catch {}
  if (!valid) throw new HttpError(403, "Żądanie musi pochodzić z panelu.", "ORIGIN_REJECTED");
}
export function sessionResponse(data: { access_token: string; refresh_token: string; expires_in: number }) {
  const response = NextResponse.json({ ok: true });
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
  response.cookies.set(ACCESS_COOKIE, data.access_token, { ...opts, maxAge: Math.min(data.expires_in, 3600) });
  response.cookies.set(REFRESH_COOKIE, data.refresh_token, { ...opts, maxAge: 7 * 86400 });
  return response;
}
export function logoutResponse() {
  const response = NextResponse.json({ ok: true });
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
export function dbFailure(error: { message: string; code?: string } | null): never {
  if (error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST202") throw new HttpError(503, "Uruchom migrację panelu administracyjnego w Supabase.", "MIGRATION_REQUIRED");
  throw new HttpError(502, "Supabase nie potwierdził operacji. Odczytaj stan przed ponowieniem.", "DATABASE_ERROR");
}
