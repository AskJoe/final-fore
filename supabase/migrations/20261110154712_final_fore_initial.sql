-- Initial schema for final-fore-local. Local application authorized November 10, 2026.
-- Remote application remains unapproved.
-- New names are intentionally not IF NOT EXISTS: a collision must abort for review.
-- Applied by the local Supabase CLI at initial database creation.
begin;
create table public.ff_members (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.ff_members enable row level security;
create policy ff_members_self on public.ff_members for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ff_members from anon, authenticated;
grant select on public.ff_members to authenticated;

-- Workbook is one bounded, versioned document so all linked formulas and audit
-- entries commit atomically. Campaigns and orders are separate records.
-- Reporting is immutable to app users and split into ordered chunks.
create table public.ff_records (
  id text primary key check (length(id) between 1 and 512),
  kind text not null check (kind in ('workbook','campaign','campaign_order','report_manifest','report_chunk')),
  version bigint not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create index ff_records_kind_id on public.ff_records(kind,id);
alter table public.ff_records enable row level security;
create policy ff_records_read on public.ff_records for select to authenticated
  using (exists (select 1 from public.ff_members m where m.user_id=(select auth.uid())));
create policy ff_records_insert on public.ff_records for insert to authenticated
  with check (kind in ('workbook','campaign','campaign_order') and exists (select 1 from public.ff_members m where m.user_id=(select auth.uid())));
create policy ff_records_update on public.ff_records for update to authenticated
  using (kind in ('workbook','campaign','campaign_order') and exists (select 1 from public.ff_members m where m.user_id=(select auth.uid())))
  with check (kind in ('workbook','campaign','campaign_order') and exists (select 1 from public.ff_members m where m.user_id=(select auth.uid())));
revoke all on public.ff_records from anon, authenticated;
grant select, insert, update on public.ff_records to authenticated;

-- Invoker rights: RLS still applies inside the function. No privileged bypass.
-- A refreshed/new order locks its source campaign as well as its own record.
create function public.ff_save_record(
  p_id text, p_kind text, p_payload jsonb, p_expected_version bigint,
  p_dependency_id text default null, p_dependency_version bigint default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare current_version bigint; current_kind text; dependency_version bigint;
begin
  if auth.uid() is null or not exists (select 1 from public.ff_members where user_id=auth.uid()) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_kind not in ('workbook','campaign','campaign_order') then
    raise exception 'Invalid record' using errcode='22023';
  end if;
  if (p_dependency_id is null) <> (p_dependency_version is null) then
    raise exception 'Invalid dependency' using errcode='22023';
  end if;
  -- Consistent lock order avoids deadlocks between dependent saves.
  perform id from public.ff_records where id=p_id or id=p_dependency_id order by id for update;
  if p_dependency_id is not null then
    select version into dependency_version from public.ff_records where id=p_dependency_id;
    if dependency_version is distinct from p_dependency_version then
      raise exception 'Source changed; refresh before saving' using errcode='40001';
    end if;
  end if;
  select version,kind into current_version,current_kind from public.ff_records where id=p_id;
  if current_version is null then
    if p_expected_version <> 0 then raise exception 'Record changed' using errcode='40001'; end if;
    insert into public.ff_records(id,kind,version,payload) values(p_id,p_kind,1,p_payload);
  else
    if current_version <> p_expected_version or current_kind <> p_kind then
      raise exception 'Record changed' using errcode='40001';
    end if;
    update public.ff_records set payload=p_payload,version=version+1,updated_at=now() where id=p_id;
  end if;
end;
$$;
revoke all on function public.ff_save_record(text,text,jsonb,bigint,text,bigint) from public, anon;
grant execute on function public.ff_save_record(text,text,jsonb,bigint,text,bigint) to authenticated;
commit;
