-- Applied to production as migration 20261017163317.
-- Players can rename themselves, but cannot edit authorization or audit fields.
-- Table grants and column grants are independent: revoke both before allowing
-- only the username column. SQL owners/service-role administration is retained.
revoke update on table public.profiles from public, anon, authenticated;
revoke update (id, username, role, username_changed, created_at)
  on table public.profiles from public, anon, authenticated;
grant update (username) on table public.profiles to authenticated;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ( id = (select auth.uid()) ) with check ( id = (select auth.uid()) );

alter function public.enforce_username_change_once() set search_path = '';

-- Cross-player cleanup is trusted maintenance, never a browser RPC.
create or replace function public.sweep_stale_plays(p_minutes int default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_minutes is null or p_minutes < 1 then
    raise exception 'p_minutes must be a positive integer' using errcode = '22023';
  end if;

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
revoke execute on function public.sweep_stale_plays(int) from public, anon, authenticated;
grant execute on function public.sweep_stale_plays(int) to service_role;
