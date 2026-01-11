"use client";

import { useEffect, useState } from "react";

export default function EnvCheck() {
  const [server, setServer] = useState<any>(null);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  useEffect(() => {
    fetch("/api/env-check")
      .then((r) => r.json())
      .then(setServer)
      .catch((e) => setServer({ error: String(e) }));
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1>/env-check</h1>

      <h3>Client</h3>
      <pre>{JSON.stringify({
        where: "client",
        url_present: !!url,
        anon_present: !!anon,
        url_sample: url ? url.slice(0, 30) + "..." : null,
        anon_sample: anon ? anon.slice(0, 6) + "..." + anon.slice(-6) : null,
      }, null, 2)}</pre>

      <h3>Server</h3>
      <pre>{JSON.stringify(server, null, 2)}</pre>
    </div>
  );
}
