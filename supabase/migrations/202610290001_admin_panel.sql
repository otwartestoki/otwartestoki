-- Run in the Supabase SQL Editor. These records are accessible only to the server.
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor uuid not null,
  table_name text not null,
  identity jsonb not null,
  before jsonb not null,
  changes jsonb not null,
  after jsonb,
  state text not null check (state in ('prepared','verified','conflict','unverified'))
);
create index if not exists admin_audit_created_idx on public.admin_audit(created_at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant all on public.admin_audit to service_role;
