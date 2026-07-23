-- ═══════════════════════════════════════════════════════════════════════════
--  Escape Room — accounts, runs, leaderboards, admin  (production schema)
--
--  HOW TO RUN:
--    Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--    Idempotent: safe to re-run any time (this is also the upgrade path).
--
--  AFTER RUNNING, to make yourself an admin:
--    1. Sign up in the game.
--    2. Table editor → profiles → your row → set role = 'admin'.
--       (Or:  update public.profiles set role='admin' where username='YOUR_NAME';)
--
--  RECOMMENDED (dashboard → Authentication → Providers → Email):
--    Turn OFF "Confirm email" so students can log in without a real inbox.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles: one row per account, linked to the auth user ──────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text unique not null,
  role       text not null default 'student',   -- 'student' | 'admin'
  created_at timestamptz not null default now()
);

-- Username rules enforced by the DB (not just the UI): 3–20 chars, letters/
-- digits/space/underscore/hyphen only. Guarded so re-running is safe.
alter table public.profiles drop constraint if exists username_format;
alter table public.profiles add  constraint username_format
  check ( char_length(username) between 3 and 20
          and username ~ '^[A-Za-z0-9 _-]+$' );

-- Case-insensitive uniqueness so "Ken" and "ken" can't both exist.
drop index if exists public.profiles_username_lower_idx;
create unique index profiles_username_lower_idx on public.profiles (lower(username));

-- Roles are locked down: role may only ever be 'student' or 'admin'.
alter table public.profiles drop constraint if exists role_valid;
alter table public.profiles add  constraint role_valid check ( role in ('student','admin') );

-- ── runs: one row per finished playthrough ──────────────────────────────────
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  room_scores int[]   not null,
  total_score int     not null check ( total_score between 0 and 100 ),
  best_time   numeric not null check ( best_time >= 0 ),
  finished_at timestamptz not null default now()
);
create index if not exists runs_user_idx on public.runs (user_id);

-- ── handle_new_user(): create the profile automatically on signup ───────────
-- Runs inside the signup transaction, so an auth user can NEVER exist without
-- its profile (no orphans, no fragile client insert). Username comes from the
-- signUp metadata; role is forced to 'student' here so it can't be spoofed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''),
             'player_' || substr(new.id::text, 1, 8)),
    'student'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── username_available(): lets the signup form pre-check a name ─────────────
-- SECURITY DEFINER so a not-yet-signed-in user can call it; only returns a
-- boolean, never any profile data.
create or replace function public.username_available(name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(trim(name))
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ── is_admin(): true when the caller's profile is an admin ──────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Row-Level Security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.runs     enable row level security;

-- profiles: read your own; admins read all. (Inserts happen via the trigger,
-- which is SECURITY DEFINER and bypasses RLS — clients never insert directly,
-- so there is intentionally no insert/update/delete policy.)
drop policy if exists "profiles_insert" on public.profiles;   -- removed: trigger handles it
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using ( id = auth.uid() or public.is_admin() );

-- runs: insert only your own; read your own, admins read all.
drop policy if exists "runs_insert" on public.runs;
create policy "runs_insert" on public.runs
  for insert with check ( user_id = auth.uid() );

drop policy if exists "runs_select" on public.runs;
create policy "runs_select" on public.runs
  for select using ( user_id = auth.uid() or public.is_admin() );

-- ── Leaderboards ─────────────────────────────────────────────────────────────
-- Exposed as SECURITY DEFINER functions (not plain views) so they can:
--   • aggregate across ALL players while exposing only username + one metric
--     (individual runs stay private under RLS), and
--   • take a p_since arg for the weekly board (null = all-time).
-- Only WON runs ever reach public.runs (submitRun fires solely on escape), and
-- P-Learn practice runs are never submitted, so no outcome/plearn filter is
-- needed here — every row in runs is a real, competitive, finished escape.
--
-- Escape Score (composite headline board): accuracy blended with a speed bonus
-- so neither axis can be cheesed. Rushing tanks accuracy; stalling tanks speed.
--   speed_pts = min(100, round(PAR / best_time * 100))   -- 100 at/under par
--   escape    = round(0.7 * total_score + 0.3 * speed_pts)
-- PAR_SECONDS is the reference "good run" time — tune it as real data comes in.
drop view if exists public.speed_leaderboard;
drop view if exists public.accuracy_leaderboard;

create or replace function public.lb_speed(p_since timestamptz default null)
returns table (username text, best_time numeric, runs bigint)
language sql security definer stable
set search_path = public
as $$
  select p.username, min(r.best_time), count(*)
  from public.runs r
  join public.profiles p on p.id = r.user_id
  where p_since is null or r.finished_at >= p_since
  group by p.username;
$$;

create or replace function public.lb_accuracy(p_since timestamptz default null)
returns table (username text, top_score int, runs bigint)
language sql security definer stable
set search_path = public
as $$
  select p.username, max(r.total_score), count(*)
  from public.runs r
  join public.profiles p on p.id = r.user_id
  where p_since is null or r.finished_at >= p_since
  group by p.username;
$$;

create or replace function public.lb_escape(p_since timestamptz default null)
returns table (username text, escape_score int, runs bigint)
language sql security definer stable
set search_path = public
as $$
  select p.username,
         max( round( 0.7 * r.total_score
                   + 0.3 * least(100, round(180.0 / greatest(r.best_time, 1) * 100)) )::int ),
         count(*)
  from public.runs r
  join public.profiles p on p.id = r.user_id
  where p_since is null or r.finished_at >= p_since
  group by p.username;
$$;

grant execute on function public.lb_speed(timestamptz)    to authenticated;
grant execute on function public.lb_accuracy(timestamptz) to authenticated;
grant execute on function public.lb_escape(timestamptz)   to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  ANALYTICS — powers the admin dashboard (charts, item analysis, funnel)
--
--  Three tables, hybrid design:
--    plays              — one row per game start→end (engagement, funnel, W/L)
--    question_attempts  — one row per answer (item analysis, mastery, misconc.)
--    events             — flexible jsonb log (future charts, no schema change)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── plays: one game start to finish (created at start, updated at end) ───────
create table if not exists public.plays (
  id              uuid primary key,                       -- client-generated
  user_id         uuid not null references public.profiles(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  outcome         text not null default 'in_progress'
                    check ( outcome in ('in_progress','won','lost','abandoned') ),
  duration_sec    int,
  rooms_completed int  not null default 0,
  total_score     int,
  best_time       numeric,
  plearn          boolean not null default false,         -- P-Learn (untimed) run?
  device          text                                    -- 'desktop' | 'mobile'
);
create index if not exists plays_user_idx    on public.plays (user_id);
create index if not exists plays_outcome_idx on public.plays (outcome);

-- ── question_attempts: one row per answer (right OR wrong) ───────────────────
create table if not exists public.question_attempts (
  id             bigint generated always as identity primary key,
  play_id        uuid references public.plays(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  room_id        int  not null,
  difficulty     text,
  qid            text not null,                 -- stable 'room.bankIndex', e.g. '1.4'
  question_text  text,
  is_correct     boolean not null,
  selected_index int,                           -- MCQ distractor (null for scaffold)
  selected_text  text,
  attempt_no     int  not null default 1,       -- 1 = first try on this question
  time_ms        int,                           -- time from prompt to this answer
  hint_shown     boolean not null default false,
  mode           text not null default 'play',  -- 'play' | 'plearn'
  created_at     timestamptz not null default now()
);
create index if not exists qa_user_idx on public.question_attempts (user_id);
create index if not exists qa_qid_idx  on public.question_attempts (qid);
create index if not exists qa_play_idx on public.question_attempts (play_id);

-- ── events: flexible log for anything else worth charting later ──────────────
create table if not exists public.events (
  id      bigint generated always as identity primary key,
  play_id uuid references public.plays(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type    text not null,                        -- 'room_clear','question_timeout',…
  data    jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);
create index if not exists events_user_idx on public.events (user_id);
create index if not exists events_type_idx on public.events (type);
create index if not exists events_play_idx on public.events (play_id);

-- ── RLS: a player writes/reads only their own rows; admins read everything ───
alter table public.plays             enable row level security;
alter table public.question_attempts enable row level security;
alter table public.events            enable row level security;

drop policy if exists "plays_insert" on public.plays;
create policy "plays_insert" on public.plays for insert with check ( user_id = auth.uid() );
drop policy if exists "plays_update" on public.plays;
create policy "plays_update" on public.plays for update using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
drop policy if exists "plays_select" on public.plays;
create policy "plays_select" on public.plays for select using ( user_id = auth.uid() or public.is_admin() );

drop policy if exists "qa_insert" on public.question_attempts;
create policy "qa_insert" on public.question_attempts for insert with check ( user_id = auth.uid() );
drop policy if exists "qa_select" on public.question_attempts;
create policy "qa_select" on public.question_attempts for select using ( user_id = auth.uid() or public.is_admin() );

drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events for insert with check ( user_id = auth.uid() );
drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events for select using ( user_id = auth.uid() or public.is_admin() );

-- ── Stale-run cleanup ────────────────────────────────────────────────────────
-- A run is tracked in the browser and resolved to won/lost/abandoned when it
-- ends. If the page dies mid-run without the unload beacon landing (e.g. a phone
-- kills a backgrounded tab), the row is orphaned at 'in_progress' forever. This
-- backstop marks such rows 'abandoned' when they are either older than a cutoff
-- OR superseded by a newer run from the same player (a stronger staleness signal).
create or replace function public.sweep_stale_plays(p_minutes int default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.plays p
     set outcome      = 'abandoned',
         ended_at     = coalesce(p.ended_at, now()),
         duration_sec = coalesce(p.duration_sec,
                                 greatest(0, extract(epoch from (now() - p.started_at))::int))
   where p.outcome = 'in_progress'
     and ( p.started_at < now() - make_interval(mins => p_minutes)
        or exists ( select 1 from public.plays q
                     where q.user_id = p.user_id and q.started_at > p.started_at ) );
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function public.sweep_stale_plays(int) to authenticated;

-- Clean up whatever orphans already exist (idempotent — safe on every re-run).
select public.sweep_stale_plays(30);

-- ── game_accuracy(): per-game learning signal (powers the progress dashboard) ──
-- One row per completed run per player, with first-try accuracy overall and by
-- difficulty. Aggregating server-side keeps the result tiny (one row per game,
-- not per answer) so it dodges the API row cap, and the client turns these rows
-- into each student's accuracy-over-games curve + an improving/flat/declining
-- verdict. Admin-only: the whole WHERE collapses to false for non-admins.
-- (Dropped first: its return columns changed, and CREATE OR REPLACE can't alter
-- a function's OUT-parameter row type.)
drop function if exists public.game_accuracy();
create or replace function public.game_accuracy()
returns table (
  user_id         uuid,
  username        text,
  play_id         uuid,
  started_at      timestamptz,
  outcome         text,
  total_score     int,
  best_time       numeric,
  rooms_completed int,
  duration_sec    int,
  plearn          boolean,
  ft_n         int,   ft_correct   int,   -- first-try, overall
  easy_n       int,   easy_correct int,
  mod_n        int,   mod_correct  int,
  hard_n       int,   hard_correct int
)
language sql
security definer
stable
set search_path = public
as $$
  select pl.user_id, pr.username, pl.id, pl.started_at, pl.outcome,
         pl.total_score, pl.best_time, pl.rooms_completed, pl.duration_sec, pl.plearn,
         count(*) filter (where qa.attempt_no = 1)::int,
         count(*) filter (where qa.attempt_no = 1 and qa.is_correct)::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'EASY')::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'EASY' and qa.is_correct)::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'MODERATE')::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'MODERATE' and qa.is_correct)::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'HARD')::int,
         count(*) filter (where qa.attempt_no = 1 and qa.difficulty = 'HARD' and qa.is_correct)::int
  from public.plays pl
  join public.profiles pr on pr.id = pl.user_id
  left join public.question_attempts qa on qa.play_id = pl.id
  where public.is_admin()
  group by pl.user_id, pr.username, pl.id, pl.started_at, pl.outcome,
           pl.total_score, pl.best_time, pl.rooms_completed, pl.duration_sec, pl.plearn
  order by pl.user_id, pl.started_at;
$$;
grant execute on function public.game_accuracy() to authenticated;

-- ── overview_stats(): KPIs, funnel, outcome split, 14-day trend, totals ───────
-- One jsonb blob so the Overview tab is a single tiny call instead of pulling
-- every plays/attempts row. Admin-only (returns null otherwise).
create or replace function public.overview_stats()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'total_plays',    (select count(*) from public.plays),
    'players',        (select count(distinct user_id) from public.plays),
    'total_answers',  (select count(*) from public.question_attempts),
    'won',            (select count(*) from public.plays where outcome = 'won'),
    'lost',           (select count(*) from public.plays where outcome = 'lost'),
    'abandoned',      (select count(*) from public.plays where outcome = 'abandoned'),
    'in_progress',    (select count(*) from public.plays where outcome = 'in_progress'),
    'finished',       (select count(*) from public.plays where outcome <> 'in_progress'),
    'avg_win_sec',    (select round(avg(duration_sec)) from public.plays where outcome = 'won'),
    'reached1',       (select count(*) from public.plays where rooms_completed >= 1),
    'reached2',       (select count(*) from public.plays where rooms_completed >= 2),
    'reached3',       (select count(*) from public.plays where rooms_completed >= 3),
    'by_day',         (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
                       from ( select started_at::date as d, count(*) as n
                              from public.plays
                              where started_at >= (now()::date - interval '13 days')
                              group by started_at::date ) t)
  ) end;
$$;
grant execute on function public.overview_stats() to authenticated;

-- ── item_stats(): per-question analysis (attempts, first-try acc, top wrong) ──
create or replace function public.item_stats()
returns table (
  qid           text,
  question_text text,
  difficulty    text,
  room_id       int,
  n             int,
  first_n       int,
  first_correct int,
  avg_time_ms   int,
  top_wrong     text,
  top_wrong_n   int
)
language sql
security definer
stable
set search_path = public
as $$
  select qa.qid,
         max(qa.question_text),
         max(qa.difficulty),
         max(qa.room_id),
         count(*)::int,
         count(*) filter (where qa.attempt_no = 1)::int,
         count(*) filter (where qa.attempt_no = 1 and qa.is_correct)::int,
         round(avg(qa.time_ms))::int,
         (select w.selected_text from public.question_attempts w
           where w.qid = qa.qid and not w.is_correct and w.selected_text is not null
           group by w.selected_text order by count(*) desc, w.selected_text limit 1),
         (select count(*)::int from public.question_attempts w
           where w.qid = qa.qid and not w.is_correct and w.selected_text is not null
           group by w.selected_text order by count(*) desc, w.selected_text limit 1)
  from public.question_attempts qa
  where public.is_admin()
  group by qa.qid;
$$;
grant execute on function public.item_stats() to authenticated;

-- ── behavior_stats(): difficulty breakdown + friction totals (one jsonb) ──────
create or replace function public.behavior_stats()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'attempts',    (select count(*) from public.question_attempts),
    'hint_shown',  (select count(*) from public.question_attempts where hint_shown),
    'timeouts',    (select count(*) from public.events where type = 'question_timeout'),
    'deaths',      (select count(*) from public.plays where outcome = 'lost'),
    'mobile',      (select count(*) from public.plays where device = 'mobile'),
    'total_plays', (select count(*) from public.plays),
    'plearn',      (select count(*) from public.plays where plearn),
    'by_diff',     (select coalesce(jsonb_agg(jsonb_build_object(
                       'difficulty',  difficulty,
                       'first_n',     first_n,
                       'first_correct', first_correct,
                       'correct_n',   correct_n,
                       'attempt_sum', attempt_sum)), '[]'::jsonb)
                     from ( select difficulty,
                              count(*) filter (where attempt_no = 1) as first_n,
                              count(*) filter (where attempt_no = 1 and is_correct) as first_correct,
                              count(*) filter (where is_correct) as correct_n,
                              sum(attempt_no) filter (where is_correct) as attempt_sum
                            from public.question_attempts
                            where difficulty is not null
                            group by difficulty ) d)
  ) end;
$$;
grant execute on function public.behavior_stats() to authenticated;

create index if not exists qa_difficulty_idx on public.question_attempts (difficulty);
