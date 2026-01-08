"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

export default function GAListener({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!window.gtag) return;

    const qs = searchParams?.toString();
    const page_path = qs ? `${pathname}?${qs}` : pathname;

    // Najczęściej stosowane w Next/SPA:
    window.gtag("config", gaId, { page_path });
  }, [pathname, searchParams, gaId]);

  return null;
}
