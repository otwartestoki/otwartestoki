import "server-only";
import { HttpError } from "./validation";
import type { Row } from "./types";

export function digitalOceanWriter() {
  const endpoint = process.env.ADMIN_DIGITALOCEAN_WRITE_URL;
  const token = process.env.ADMIN_DIGITALOCEAN_WRITE_TOKEN;
  if (!endpoint && !token) return null;
  if (!endpoint || !token || !URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
    throw new HttpError(503, "Brak pełnej konfiguracji zapisu na DigitalOcean.");
  }

  return async (table: string, identity: Row, before: Row | null, patch: Row): Promise<Row> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ table, identity, before, patch }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error("DigitalOcean did not confirm the write");
    const result = await response.json() as { record?: Row };
    if (!result.record) throw new Error("DigitalOcean did not return the verified record");
    return result.record;
  };
}

export async function digitalOceanRead<T>(request: Record<string, unknown>): Promise<T> {
  const endpoint = process.env.ADMIN_DIGITALOCEAN_WRITE_URL;
  const token = process.env.ADMIN_DIGITALOCEAN_WRITE_TOKEN;
  if (!endpoint || !token || !URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
    throw new HttpError(503, "Brak pełnej konfiguracji odczytu z DigitalOcean.");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, operation: "read" }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`DigitalOcean nie potwierdził odczytu (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}
