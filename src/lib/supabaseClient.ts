import { createClient, SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __supabase: SupabaseClient | undefined;
}

function getEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

function createSupabaseSafe(): SupabaseClient | null {
  const { url, key } = getEnv();

  // Log w SSR/build (Vercel pokaże to w build logs)
  if (typeof window === "undefined") {
    console.log("[supabaseClient] SSR/build env check:", {
      hasUrl: Boolean(url),
      hasKey: Boolean(key),
      nodeEnv: process.env.NODE_ENV,
    });
  }

  // Jeśli nie ma ENV, nie wywalaj buildu
  if (!url || !key) return null;

  return createClient(url, key);
}

/**
 * Exportujemy coś, co nie wysadzi buildu.
 * Jeśli env braknie, supabase będzie "proxy" rzucającym błąd dopiero przy użyciu.
 */
const real = createSupabaseSafe();

export const supabase: SupabaseClient = real
  ? real
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            "Supabase client is not initialized. Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
              "Set them in Vercel Environment Variables for Preview/Production."
          );
        },
      }
    ) as unknown as SupabaseClient);
