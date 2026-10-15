alter table public.reading_sessions add column reader_position jsonb;
grant select(reader_position) on public.reading_sessions to authenticated;

create function public.poll_reading_session_v2(
 access_token text, ack bigint, reader_state text, include_snapshot boolean, p_reader_position jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reading_sessions;
begin
 if length(access_token)<>64 or reader_state not in ('paused','playing','countdown')
  or jsonb_typeof(p_reader_position) is distinct from 'object'
  or jsonb_typeof(p_reader_position->'blockId') is distinct from 'string'
  or length(p_reader_position->>'blockId')>100
  or octet_length(p_reader_position::text)>300 then raise exception 'Invalid request'; end if;
 update public.reading_sessions set
  ack_sequence=greatest(ack_sequence,least(ack,sequence)),
  last_seen=now(),reader_state=poll_reading_session_v2.reader_state,
  reader_position=p_reader_position
 where token_hash=extensions.digest(access_token,'sha256') and not revoked and expires_at>now()
 returning * into s;
 if not found then raise exception 'Session expired'; end if;
 return jsonb_build_object('sequence',s.sequence,'command',s.command,
  'snapshot',case when include_snapshot or (s.command->>'action'='reload' and ack<s.sequence) then s.snapshot else null end);
end $$;
revoke all on function public.poll_reading_session_v2(text,bigint,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.poll_reading_session_v2(text,bigint,text,boolean,jsonb) to anon,authenticated;
