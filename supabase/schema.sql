-- ═══════════════════════════════════════════════════════════════════════════
--  Escape Room — accounts, runs, leaderboards, admin
--
--  HOW TO RUN:
--    Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--    Safe to re-run (drops/creates are guarded).
--
--  AFTER RUNNING, to make yourself an admin:
--    1. Sign up in the game with your email.
--    2. Dashboard → Table editor → profiles → find your row → set role = 'admin'.
--    (Or run:  update profiles set role='admin' where username='YOUR_NAME';)
--
--  RECOMMENDED SETTINGS (dashboard → Authentication → Providers → Email):
--    Turn OFF "Confirm email" so students can log in without a real inbox.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles: one row per account, linked to the auth user ──────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text unique not null,
  role       text not null default 'student',   -- 'student' | 'admin'
  created_at timestamptz not null default now()
);

-- ── runs: one row per finished playthrough ──────────────────────────────────
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  room_scores int[]   not null,            -- [room1%, room2%, room3%]
  total_score int     not null,            -- 0..100 (average accuracy)
  best_time   numeric not null,            -- completion time, seconds
  finished_at timestamptz not null default now()
);
create index if not exists runs_user_idx on public.runs (user_id);

-- ── is_admin(): true when the caller's profile is an admin ──────────────────
-- SECURITY DEFINER so it can read profiles without tripping RLS recursion.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Row-Level Security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.runs     enable row level security;

-- profiles: anyone signed in can read their own; admins read all.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using ( id = auth.uid() or public.is_admin() );

-- profiles: you may create ONLY your own row, and only as a 'student'
-- (prevents self-promotion to admin at signup).
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert with check ( id = auth.uid() and role = 'student' );

-- (No UPDATE/DELETE policy → clients can't change roles. Admins are set in the
--  dashboard, which uses the service role and bypasses RLS.)

-- runs: you may insert only your own; you read your own, admins read all.
drop policy if exists "runs_insert" on public.runs;
create policy "runs_insert" on public.runs
  for insert with check ( user_id = auth.uid() );

drop policy if exists "runs_select" on public.runs;
create policy "runs_select" on public.runs
  for select using ( user_id = auth.uid() or public.is_admin() );

-- ── Leaderboard views ───────────────────────────────────────────────────────
-- Owner-permission views: they aggregate across ALL players but expose only a
-- username + one best metric, so they're safe to read by any signed-in player
-- even though individual runs stay private.
create or replace view public.speed_leaderboard as
  select p.username, min(r.best_time) as best_time, count(*) as runs
  from public.runs r
  join public.profiles p on p.id = r.user_id
  group by p.username;

create or replace view public.accuracy_leaderboard as
  select p.username, max(r.total_score) as top_score, count(*) as runs
  from public.runs r
  join public.profiles p on p.id = r.user_id
  group by p.username;

grant select on public.speed_leaderboard    to authenticated;
grant select on public.accuracy_leaderboard  to authenticated;
