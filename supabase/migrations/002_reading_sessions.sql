create extension if not exists pgcrypto with schema extensions;
create table public.reading_sessions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 token_hash bytea not null unique, snapshot jsonb not null, command jsonb not null default '{"action":"pause"}',
 sequence bigint not null default 0, ack_sequence bigint not null default -1,
 reader_state text not null default 'waiting', last_seen timestamptz,
 expires_at timestamptz not null default now()+interval '2 hours', revoked boolean not null default false
);
alter table public.reading_sessions enable row level security;
revoke all on public.reading_sessions from anon,authenticated;
grant select(id,owner_id,sequence,ack_sequence,last_seen,reader_state,expires_at,revoked) on public.reading_sessions to authenticated;
create policy own_reading_sessions on public.reading_sessions for select to authenticated using(owner_id=(select auth.uid()));

create function public.create_reading_session(snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare access_token text; session_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if octet_length(snapshot::text)>2000000 or jsonb_typeof(snapshot->'html') is distinct from 'string' then raise exception 'Invalid snapshot'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if (select count(*) from public.reading_sessions where owner_id=auth.uid() and not revoked and expires_at>now())>=5 then raise exception 'Termine une session existante avant d’en créer une nouvelle.'; end if;
 access_token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.reading_sessions(owner_id,token_hash,snapshot) values(auth.uid(),extensions.digest(access_token,'sha256'),snapshot) returning id into session_id;
 return jsonb_build_object('id',session_id,'token',access_token);
end $$;

create function public.send_reading_command(session_id uuid,expected_sequence bigint,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actual bigint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if coalesce(command->>'action','') not in ('play','pause','seek','speed','settings') or octet_length(command::text)>10000 then raise exception 'Invalid command'; end if;
 if command->>'action'='settings' and jsonb_typeof(command->'settings') is distinct from 'object' then raise exception 'Invalid settings'; end if;
 select sequence into actual from public.reading_sessions where id=session_id and owner_id=auth.uid() and not revoked and expires_at>now() for update;
 if not found then raise exception 'Session expired'; end if;
 if actual<>expected_sequence then return jsonb_build_object('conflict',true,'sequence',actual); end if;
 update public.reading_sessions set command=send_reading_command.command,sequence=sequence+1,
 snapshot=case when send_reading_command.command->>'action'='settings' then jsonb_set(snapshot,'{settings}',send_reading_command.command->'settings')
 when send_reading_command.command->>'action' in ('speed','play') and send_reading_command.command ? 'speed' then jsonb_set(snapshot,'{settings,speed}',send_reading_command.command->'speed') else snapshot end
 where id=session_id returning sequence into actual;
 return jsonb_build_object('conflict',false,'sequence',actual);
end $$;

create function public.poll_reading_session(access_token text,ack bigint,reader_state text,include_snapshot boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reading_sessions;
begin
 if length(access_token)<>64 or reader_state not in ('paused','playing','countdown') then raise exception 'Invalid request'; end if;
 update public.reading_sessions set ack_sequence=greatest(ack_sequence,least(ack,sequence)),last_seen=now(),reader_state=poll_reading_session.reader_state
 where token_hash=extensions.digest(access_token,'sha256') and not revoked and expires_at>now() returning * into s;
 if not found then raise exception 'Session expired'; end if;
 return jsonb_build_object('sequence',s.sequence,'command',s.command,'snapshot',case when include_snapshot or (s.command->>'action'='reload' and ack<s.sequence) then s.snapshot else null end);
end $$;

create function public.revoke_reading_session(session_id uuid) returns void language sql security definer set search_path='' as $$
 update public.reading_sessions set revoked=true where id=session_id and owner_id=auth.uid();
$$;
revoke all on function public.create_reading_session(jsonb) from public;
revoke all on function public.send_reading_command(uuid,bigint,jsonb) from public;
revoke all on function public.poll_reading_session(text,bigint,text,boolean) from public;
revoke all on function public.revoke_reading_session(uuid) from public;
grant execute on function public.create_reading_session(jsonb),public.send_reading_command(uuid,bigint,jsonb),public.revoke_reading_session(uuid) to authenticated;
grant execute on function public.poll_reading_session(text,bigint,text,boolean) to anon,authenticated;

create function public.update_reading_snapshot(session_id uuid,new_snapshot jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare actual bigint;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if octet_length(new_snapshot::text)>2000000 or jsonb_typeof(new_snapshot->'html') is distinct from 'string' then raise exception 'Invalid snapshot'; end if;
 update public.reading_sessions set snapshot=new_snapshot,command='{"action":"reload"}'::jsonb,sequence=sequence+1
 where id=session_id and owner_id=auth.uid() and not revoked and expires_at>now()
 and reader_state='paused' and last_seen>now()-interval '5 seconds' and ack_sequence=sequence
 returning sequence into actual;
 if not found then raise exception 'Mets le lecteur en pause et attends sa confirmation avant de charger le texte.'; end if;
 return actual;
end $$;
revoke all on function public.update_reading_snapshot(uuid,jsonb) from public;
grant execute on function public.update_reading_snapshot(uuid,jsonb) to authenticated;
