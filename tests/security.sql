-- Run as the database owner (SQL Editor or psql) after applying schema.sql or
-- the hardening migration. Only generated fixture accounts are edited; the
-- whole transaction, including those accounts and all renames, is rolled back.
begin;

do $fixtures$
declare
  student uuid := gen_random_uuid();
  other_student uuid := gen_random_uuid();
begin
  perform set_config('probxcape.test_student', student::text, true);
  perform set_config('probxcape.test_other_student', other_student::text, true);
  insert into auth.users (id, raw_user_meta_data) values
    (student, jsonb_build_object('username', 'perm_' || substr(student::text, 1, 12))),
    (other_student, jsonb_build_object('username', 'perm_' || substr(other_student::text, 1, 12)));
end;
$fixtures$;

select set_config('request.jwt.claim.sub', current_setting('probxcape.test_student'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('probxcape.test_student'), 'role', 'authenticated'
)::text, true);
set local role authenticated;

do $student_tests$
declare
  student uuid := current_setting('probxcape.test_student')::uuid;
  other_student uuid := current_setting('probxcape.test_other_student')::uuid;
  updated integer;
begin
  if not exists (select 1 from public.profiles where id = student and role = 'student') then
    raise exception 'FAIL: a student can read their own profile';
  end if;

  begin
    update public.profiles set role = 'admin' where id = student;
    raise exception 'FAIL: students must not update their role';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set username_changed = false where id = student;
    raise exception 'FAIL: students must not reset the rename guard';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set created_at = now() where id = student;
    raise exception 'FAIL: students must not edit audit fields';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set username = 'perm_' || substr(student::text, 1, 12) || '_ok'
    where id = student;
  get diagnostics updated = row_count;
  if updated <> 1 or not (select username_changed from public.profiles where id = student) then
    raise exception 'FAIL: the first rename must work and set its guard';
  end if;

  begin
    update public.profiles set username = 'perm_second_rename' where id = student;
    raise exception 'FAIL: a second rename must be rejected';
  exception when raise_exception then
    if sqlerrm <> 'username_already_changed' then raise; end if;
  end;

  update public.profiles set username = 'perm_other_rename' where id = other_student;
  get diagnostics updated = row_count;
  if updated <> 0 then raise exception 'FAIL: students must not rename another player'; end if;

  begin
    perform public.sweep_stale_plays(30);
    raise exception 'FAIL: students must not invoke cross-player cleanup';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.admin_reset_players(array[student]);
    raise exception 'FAIL: students must not invoke admin actions';
  exception when raise_exception then
    if sqlerrm <> 'not_admin' then raise; end if;
  end;
end;
$student_tests$;

set local role anon;
do $anon_tests$
begin
  begin
    perform public.sweep_stale_plays(30);
    raise exception 'FAIL: anonymous callers must not invoke cleanup';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set username = 'perm_anon_rename'
      where id = current_setting('probxcape.test_student')::uuid;
    raise exception 'FAIL: anonymous callers must not update profiles';
  exception when insufficient_privilege then null;
  end;
end;
$anon_tests$;

reset role;
do $grant_tests$
begin
  if not has_function_privilege('service_role', 'public.sweep_stale_plays(integer)', 'EXECUTE') then
    raise exception 'FAIL: trusted maintenance must retain cleanup access';
  end if;
  if not has_column_privilege('service_role', 'public.profiles', 'role', 'UPDATE') then
    raise exception 'FAIL: trusted administration must retain role management';
  end if;
end;
$grant_tests$;

rollback;
select 'PASS: role escalation and public cleanup blocked; rename and trusted access preserved; fixtures rolled back' as result;
