alter table public.reading_sessions
 add column project_id text,
 add column script_id text,
 add column pair_code text,
 add constraint reading_sessions_pair_code_format check (pair_code is null or pair_code ~ '^[0-9]{6}$');

create unique index reading_sessions_owner_pair_code on public.reading_sessions(owner_id,pair_code) where pair_code is not null;
grant select(project_id,script_id,pair_code) on public.reading_sessions to authenticated;

create schema if not exists souffle_private;
create table souffle_private.reading_pair_attempts (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 window_started timestamptz not null default now(),
 failures integer not null default 0
);
alter table souffle_private.reading_pair_attempts enable row level security;
revoke all on schema souffle_private from public,anon,authenticated;
revoke all on souffle_private.reading_pair_attempts from public,anon,authenticated;

create function public.create_project_reading_session(p_project_id text,p_script_id text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare active public.reading_sessions; created jsonb; bytes bytea; code text; tries integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(coalesce(p_project_id,'')) not between 1 and 100 or length(coalesce(p_script_id,'')) not between 1 and 100 then raise exception 'Invalid project or script'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 select * into active from public.reading_sessions
 where owner_id=auth.uid() and project_id=p_project_id and not revoked and expires_at>now()
 order by expires_at desc limit 1 for update;
 if found then
  return jsonb_build_object('id',active.id,'code',active.pair_code,'sequence',active.sequence,'scriptId',active.script_id,'reused',true);
 end if;
 created=public.create_reading_session(p_snapshot);
 for tries in 1..12 loop
  bytes=extensions.gen_random_bytes(4);
  code=lpad((((get_byte(bytes,0)::bigint*16777216)+(get_byte(bytes,1)::bigint*65536)+(get_byte(bytes,2)::bigint*256)+get_byte(bytes,3))%1000000)::text,6,'0');
  exit when not exists(select 1 from public.reading_sessions where owner_id=auth.uid() and pair_code=code);
 end loop;
 if tries>12 then raise exception 'Code unavailable'; end if;
 update public.reading_sessions set project_id=p_project_id,script_id=p_script_id,pair_code=code where id=(created->>'id')::uuid;
 return jsonb_build_object('id',created->>'id','code',code,'sequence',0,'scriptId',p_script_id,'reused',false);
end $$;
revoke all on function public.create_project_reading_session(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_project_reading_session(text,text,jsonb) to authenticated;

create function public.join_project_reading_session(p_pair_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempts souffle_private.reading_pair_attempts; active public.reading_sessions; access_token text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if coalesce(p_pair_code,'') !~ '^[0-9]{6}$' then return jsonb_build_object('error','invalid'); end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,2));
 insert into souffle_private.reading_pair_attempts(owner_id) values(auth.uid()) on conflict (owner_id) do nothing;
 select * into attempts from souffle_private.reading_pair_attempts where owner_id=auth.uid() for update;
 if attempts.window_started<now()-interval '10 minutes' then
  update souffle_private.reading_pair_attempts set window_started=now(),failures=0 where owner_id=auth.uid();
  attempts.failures=0;
 end if;
 if attempts.failures>=8 then return jsonb_build_object('error','limited'); end if;
 select * into active from public.reading_sessions where owner_id=auth.uid() and pair_code=p_pair_code
  and not revoked and expires_at>now() limit 1 for update;
 if not found then
  update souffle_private.reading_pair_attempts set failures=failures+1 where owner_id=auth.uid();
  return jsonb_build_object('error','invalid');
 end if;
 access_token=encode(extensions.gen_random_bytes(32),'hex');
 update public.reading_sessions set token_hash=extensions.digest(access_token,'sha256'),last_seen=null,
  reader_state='waiting',ack_sequence=-1 where id=active.id;
 update souffle_private.reading_pair_attempts set failures=0,window_started=now() where owner_id=auth.uid();
 return jsonb_build_object('id',active.id,'token',access_token,'projectId',active.project_id,'scriptId',active.script_id);
end $$;
revoke all on function public.join_project_reading_session(text) from public,anon,authenticated;
grant execute on function public.join_project_reading_session(text) to authenticated;

create function public.switch_project_reading_script(p_session_id uuid,p_script_id text,p_snapshot jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare next_sequence bigint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(coalesce(p_script_id,'')) not between 1 and 100 or octet_length(p_snapshot::text)>2000000
  or jsonb_typeof(p_snapshot->'html') is distinct from 'string' then raise exception 'Invalid script snapshot'; end if;
 update public.reading_sessions set script_id=p_script_id,snapshot=p_snapshot,
  command='{"action":"reload"}'::jsonb,sequence=sequence+1
 where id=p_session_id and owner_id=auth.uid() and project_id is not null and not revoked and expires_at>now()
 returning sequence into next_sequence;
 if not found then raise exception 'Session expired'; end if;
 return next_sequence;
end $$;
revoke all on function public.switch_project_reading_script(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.switch_project_reading_script(uuid,text,jsonb) to authenticated;
