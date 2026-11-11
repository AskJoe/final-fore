-- Application version conflicts return HTTP 409 without a serialization retry.
-- Preserve all locks, version checks, and stored data.
begin;
create or replace function public.ff_save_record(
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
      raise exception 'Source changed; refresh before saving' using errcode='PT409';
    end if;
  end if;
  select version,kind into current_version,current_kind from public.ff_records where id=p_id;
  if current_version is null then
    if p_expected_version <> 0 then raise exception 'Record changed' using errcode='PT409'; end if;
    insert into public.ff_records(id,kind,version,payload) values(p_id,p_kind,1,p_payload);
  else
    if current_version <> p_expected_version or current_kind <> p_kind then
      raise exception 'Record changed' using errcode='PT409';
    end if;
    update public.ff_records set payload=p_payload,version=version+1,updated_at=now() where id=p_id;
  end if;
end;
$$;
commit;
