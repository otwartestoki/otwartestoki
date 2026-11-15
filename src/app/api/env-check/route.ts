export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    where: "server",
    digitalocean_configured: Boolean(process.env.ADMIN_DIGITALOCEAN_WRITE_URL && process.env.ADMIN_DIGITALOCEAN_WRITE_TOKEN),
    admin_database: process.env.ADMIN_DATABASE_MODE || "dual",
    node_env: process.env.NODE_ENV ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    git_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    git_branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  });
}
