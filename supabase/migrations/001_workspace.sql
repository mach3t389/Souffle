-- Appliquer dans le projet Supabase. Aucune clé service_role dans le navigateur.
create table public.workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null check (data->>'schemaVersion' = '2'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create policy own_workspace on public.workspaces for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.workspaces from anon, authenticated;
grant select on public.workspaces to authenticated;

create function public.save_workspace(payload jsonb, expected_revision bigint, expected_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actual bigint;
begin
 if auth.uid() is null or auth.uid() <> expected_owner then raise exception 'Authentication required'; end if;
 if payload->>'schemaVersion' is distinct from '2' or jsonb_typeof(payload->'projects') is distinct from 'array' or octet_length(payload::text)>10000000 then raise exception 'Invalid workspace'; end if;
 -- Serialize first creation and updates for this account.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select revision into actual from public.workspaces where owner_id=auth.uid() for update;
 if coalesce(actual,0) <> expected_revision then return jsonb_build_object('conflict',true,'revision',coalesce(actual,0)); end if;
 insert into public.workspaces(owner_id,data,revision) values(auth.uid(),payload,1)
 on conflict(owner_id) do update set data=excluded.data,revision=public.workspaces.revision+1,updated_at=now()
 returning revision into actual;
 return jsonb_build_object('conflict',false,'revision',actual);
end $$;
revoke all on function public.save_workspace(jsonb,bigint,uuid) from public;
grant execute on function public.save_workspace(jsonb,bigint,uuid) to authenticated;
