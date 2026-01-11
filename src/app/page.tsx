import React, { Suspense } from "react";
import HomeClient from "./HomeClient";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 20, fontFamily: "system-ui, Arial" }}>Ładowanie…</div>}>
      <HomeClient />
    </Suspense>
  );
}
