-- REVIEW ARTIFACT ONLY. Not applied. Explicit coverage confirmations separate from vendor records.
begin;
create table public.ff_research_assignments (
  rep_id text not null,template_id text not null references public.ff_research_templates(id),
  revision bigint not null check(revision>0),payload jsonb not null,
  updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
  primary key(rep_id,template_id)
);
alter table public.ff_research_assignments enable row level security;
revoke all on public.ff_research_assignments from anon,authenticated;
grant select on public.ff_research_assignments to authenticated;
grant all on public.ff_research_assignments to service_role;
create policy research_assignments_read on public.ff_research_assignments for select to authenticated using(exists(select 1 from ff_members where user_id=auth.uid()));
create function public.ff_research_confirm_assignment(p_assignment jsonb,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_member uuid:=auth.uid();d ff_records;r jsonb;t ff_research_templates;a ff_research_assignments;v_payload jsonb;
begin
  if v_member is null or not exists(select 1 from ff_members where user_id=v_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-assignments',0));
  select * into d from ff_records where id='directory' for share;
  if d.version is distinct from (p_assignment->>'directoryRevision')::bigint then raise exception using errcode='PT409',message='Directory changed.'; end if;
  select x into r from jsonb_array_elements(d.payload->'reps') x where x->>'id'=p_assignment->>'repId' and x->'active'='true'::jsonb;
  select * into t from ff_research_templates where id=p_assignment->>'templateId' for share;
  if r is null or t.id is null or r->>'firmId' is distinct from p_assignment->>'firmId' or lower(r->>'email') is distinct from p_assignment->>'email'
    or not exists(select 1 from jsonb_array_elements(r->'coverage') c where c->>'mediaType'=t.payload->>'media') then raise exception 'Save the template and choose a compatible active rep.'; end if;
  if jsonb_typeof(p_assignment->'confirmed') is distinct from 'boolean' or jsonb_typeof(p_assignment->'cc') is distinct from 'array' then raise exception 'Invalid coverage confirmation.'; end if;
  select * into a from ff_research_assignments where rep_id=r->>'id' and template_id=t.id for update;
  if coalesce(a.revision,0) is distinct from p_expected_revision then raise exception using errcode='PT409',message='Coverage changed. Refresh first.'; end if;
  v_payload:=p_assignment||jsonb_build_object('revision',p_expected_revision+1);
  insert into ff_research_assignments(rep_id,template_id,revision,payload,updated_by) values(r->>'id',t.id,p_expected_revision+1,v_payload,v_member)
    on conflict(rep_id,template_id) do update set revision=excluded.revision,payload=excluded.payload,updated_by=v_member,updated_at=now();
  return v_payload;
end $$;
revoke all on function public.ff_research_confirm_assignment(jsonb,bigint) from public,anon;
grant execute on function public.ff_research_confirm_assignment(jsonb,bigint) to authenticated;
commit;
