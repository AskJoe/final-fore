-- REVIEW ARTIFACT ONLY. Do not apply without Joe's database approval.
-- Adds research template storage; does not modify directory data or seed cities.
begin;

create table public.ff_research_templates (
  id text primary key check (length(id) between 1 and 100),
  revision bigint not null check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.ff_research_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id text not null references public.ff_research_templates(id),
  version bigint not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unique (template_id, version)
);
alter table public.ff_research_templates enable row level security;
alter table public.ff_research_template_versions enable row level security;
create policy research_templates_member_read on public.ff_research_templates for select to authenticated
  using (exists(select 1 from public.ff_members where user_id = auth.uid()));
create policy research_versions_member_read on public.ff_research_template_versions for select to authenticated
  using (exists(select 1 from public.ff_members where user_id = auth.uid()));
revoke all on public.ff_research_templates, public.ff_research_template_versions from anon, authenticated;
grant select on public.ff_research_templates, public.ff_research_template_versions to authenticated;
grant all on public.ff_research_templates, public.ff_research_template_versions to service_role;

create function public.ff_research_save_template(
  p_template jsonb,
  p_expected_revision bigint,
  p_directory_revision bigint,
  p_publish boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := auth.uid();
  v_current public.ff_research_templates;
  v_directory public.ff_records;
  v_client jsonb;
  v_market jsonb;
  v_saved jsonb;
  v_version jsonb;
  v_version_id uuid;
  v_version_number bigint;
  v_market_count integer;
  v_revision bigint;
begin
  if v_member is null or not exists(select 1 from public.ff_members where user_id = v_member) then
    raise exception using errcode = '42501', message = 'Membership required.';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_directory_revision is null then
    raise exception using errcode = '22023', message = 'Invalid revision.';
  end if;
  if jsonb_typeof(p_template) is distinct from 'object'
    or jsonb_typeof(p_template->'markets') is distinct from 'array'
    or jsonb_typeof(p_template->'defaults') is distinct from 'object'
    or coalesce(length(p_template->>'id'),0) not between 1 and 100
    or coalesce(length(trim(p_template->>'name')),0) not between 1 and 200
    or coalesce(length(trim(p_template->>'subject')),0) not between 1 and 1000
    or coalesce(length(trim(p_template->>'body')),0) not between 1 and 100000
    or coalesce(p_template->>'media','') not in ('broadcast-radio','broadcast-tv')
    or coalesce(p_template->>'scope','') not in ('single','multi')
    or position('{{upload_url}}' in coalesce(p_template->>'body','')) = 0 then
    raise exception using errcode = '22023', message = 'Invalid research template.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_template) as k where k not in
    ('id','name','clientId','campaignKey','media','scope','subject','body','revision','status','markets','defaults','sourceHash')) then
    raise exception using errcode = '22023', message = 'Unknown template field.';
  end if;
  -- Serializes first insert as well as later edits for the same template.
  perform pg_advisory_xact_lock(hashtextextended('research-template:' || (p_template->>'id'), 0));
  select * into v_directory from public.ff_records where id = 'directory' for share;
  if v_directory.id is null or v_directory.version <> p_directory_revision then
    raise exception using errcode = 'PT409', message = 'The directory changed. Reload before saving.';
  end if;
  select c into v_client from jsonb_array_elements(v_directory.payload->'clients') c
    where c->>'id' = p_template->>'clientId' and c->'active' = 'true'::jsonb;
  if v_client is null then raise exception using errcode = '22023', message = 'Choose an active client.'; end if;
  v_market_count := jsonb_array_length(p_template->'markets');
  if v_market_count > 200 or (p_template->>'scope' = 'single' and v_market_count <> 1)
    or (p_template->>'scope' = 'multi' and v_market_count < 2) then
    raise exception using errcode = '22023', message = 'Invalid number of template markets.';
  end if;
  for v_market in select value from jsonb_array_elements(p_template->'markets') loop
    if jsonb_typeof(v_market) is distinct from 'object'
      or coalesce(length(trim(v_market->>'displayName')),0) not between 1 and 200
      or not v_market ? 'marketId' then
      raise exception using errcode = '22023', message = 'Invalid template market.';
    end if;
    if v_market->>'marketId' is null then
      if p_publish then raise exception using errcode = '22023', message = 'Confirm every market before publishing.'; end if;
    elsif not (v_client->'marketIds') ? (v_market->>'marketId') then
      raise exception using errcode = '22023', message = 'Market does not belong to the client.';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_template->'markets') m group by m->>'displayName' having count(*) > 1)
    or exists(select 1 from jsonb_array_elements(p_template->'markets') m where m->>'marketId' is not null group by m->>'marketId' having count(*) > 1) then
    raise exception using errcode = '22023', message = 'Choose each market only once.';
  end if;
  select * into v_current from public.ff_research_templates where id = p_template->>'id' for update;
  if coalesce(v_current.revision,0) <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'The template changed. Reload before saving.';
  end if;
  if v_current.id is not null and (
    v_current.payload->'clientId' is distinct from p_template->'clientId'
    or v_current.payload->'campaignKey' is distinct from p_template->'campaignKey'
    or v_current.payload->'media' is distinct from p_template->'media'
    or v_current.payload->'scope' is distinct from p_template->'scope'
    or v_current.payload->'sourceHash' is distinct from p_template->'sourceHash') then
    raise exception using errcode = '22023', message = 'Template identity cannot be changed.';
  end if;
  v_revision := p_expected_revision + 1;
  v_saved := p_template || jsonb_build_object('revision',v_revision,'status',case when p_publish then 'published' else 'draft' end);
  insert into public.ff_research_templates(id,revision,payload,updated_by)
    values(p_template->>'id',v_revision,v_saved,v_member)
    on conflict(id) do update set revision=excluded.revision,payload=excluded.payload,updated_by=v_member,updated_at=now();
  if not p_publish then return v_saved; end if;
  select coalesce(max(version),0)+1 into v_version_number from public.ff_research_template_versions where template_id=p_template->>'id';
  v_version_id := gen_random_uuid();
  v_version := v_saved || jsonb_build_object('versionId',v_version_id,'version',v_version_number);
  insert into public.ff_research_template_versions(id,template_id,version,payload,published_by)
    values(v_version_id,p_template->>'id',v_version_number,v_version,v_member);
  return v_version;
end;
$$;
revoke all on function public.ff_research_save_template(jsonb,bigint,bigint,boolean) from public, anon;
grant execute on function public.ff_research_save_template(jsonb,bigint,bigint,boolean) to authenticated;
commit;
