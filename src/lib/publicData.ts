export async function publicData<T>(action: string, params: Record<string, unknown> = {}) {
  const response = await fetch("/api/public-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Nie udało się pobrać danych z bazy DigitalOcean (HTTP ${response.status}).`);
  const result = await response.json() as { data: T };
  return result.data;
}
