"use client";

import { useEffect, useState } from "react";

export default function EnvCheck() {
  const [server, setServer] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/env-check")
      .then((r) => r.json() as Promise<Record<string, unknown>>)
      .then(setServer)
      .catch((e) => setServer({ error: String(e) }));
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1>/env-check</h1>

      <h3>Połączenie z bazą</h3>
      <pre>{JSON.stringify(server, null, 2)}</pre>
    </div>
  );
}
