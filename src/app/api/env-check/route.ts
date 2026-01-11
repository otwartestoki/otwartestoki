export const runtime = "nodejs";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  return Response.json({
    where: "server",
    url_present: !!url,
    anon_present: !!anon,
    url_sample: url ? url.slice(0, 30) + "..." : null,
    anon_sample: anon ? anon.slice(0, 6) + "..." + anon.slice(-6) : null,
    node_env: process.env.NODE_ENV ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    git_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    git_branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  });
}
