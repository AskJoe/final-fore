-- REVIEW ARTIFACT ONLY. Includes private Storage setup; do not apply without approval.
begin;
create table public.ff_research_files (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ff_research_conversations(id),
  market_id text,
  name text not null check(length(name) between 1 and 240),
  size bigint not null check(size between 0 and 104857600),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  content_type text not null,
  object_key text not null unique,
  state text not null default 'uploading' check(state in ('uploading','checking','ready','held','failed')),
  source text not null default 'portal' check(source in ('portal','email')),
  source_attachment_id text unique,
  uploader text,
  duplicate_of uuid references public.ff_research_files(id),
  recovery_checked_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(size>0 or (source='email' and state='held'))
);
-- Deduplicate within an authorization boundary. Internal email bytes never confer portal access.
create unique index research_files_dedup on public.ff_research_files(conversation_id,market_id,sha256,source) where duplicate_of is null;
create index research_files_incoming on public.ff_research_files(updated_at,id);
alter table public.ff_research_files enable row level security;
revoke all on public.ff_research_files from anon,authenticated;
grant all on public.ff_research_files to service_role;
grant select on public.ff_research_files to authenticated;
create policy research_files_read on public.ff_research_files for select to authenticated using(exists(select 1 from public.ff_members where user_id=auth.uid()));
insert into storage.buckets(id,name,public,file_size_limit) values('research-files','research-files',false,104857600) on conflict(id) do nothing;
do $$ begin
  if not exists(select 1 from storage.buckets where id='research-files' and public=false and file_size_limit=104857600) then
    raise exception 'Existing research-files bucket differs from the reviewed private configuration.';
  end if;
end $$;
create policy research_storage_server_only on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id<>'research-files') with check(bucket_id<>'research-files');

create function public.ff_research_reserve_file(p_conversation uuid,p_market text,p_name text,p_size bigint,p_hash text,p_type text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; f ff_research_files; v_id uuid:=gen_random_uuid();
begin
  select * into c from ff_research_conversations where id=p_conversation for update;
  if c.id is null or c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then raise exception using errcode='42501',message='Research collection is not open.'; end if;
  if not exists(select 1 from jsonb_array_elements(c.manifest->'markets') m where m->>'marketId'=p_market) then raise exception using errcode='22023',message='Market is outside this template.'; end if;
  select * into f from ff_research_files where conversation_id=c.id and market_id=p_market and sha256=p_hash and source='portal' and duplicate_of is null;
  if f.id is not null then return to_jsonb(f); end if;
  if (select count(*) from ff_research_files where conversation_id=c.id and created_at>now()-interval '1 minute')>=40 then raise exception using errcode='PT429',message='Upload queue is busy. Retry shortly.'; end if;
  if (select coalesce(sum(size),0) from ff_research_files where conversation_id=c.id)+p_size>5368709120 then raise exception using errcode='22023',message='Research collection storage limit reached.'; end if;
  insert into ff_research_files(id,conversation_id,market_id,name,size,sha256,content_type,object_key)
    values(v_id,c.id,p_market,p_name,p_size,p_hash,p_type,c.id::text||'/'||v_id::text) returning * into f;
  return to_jsonb(f);
end $$;
create function public.ff_research_finalize_file(p_conversation uuid,p_file uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; f ff_research_files;
begin
  select * into c from ff_research_conversations where id=p_conversation for share;
  if c.id is null or c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then raise exception using errcode='42501',message='Research collection is not open.'; end if;
  select * into f from ff_research_files where id=p_file and conversation_id=c.id for update;
  if f.id is null then raise exception using errcode='22023',message='File does not belong to this upload link.'; end if;
  if f.state in ('ready','held','checking') then return; end if;
  update ff_research_files set state='checking',error=null,updated_at=now() where id=f.id;
  insert into ff_research_jobs(operation_key,kind,payload) values('verify-file:'||f.id::text,'verify-file',jsonb_build_object('fileId',f.id))
    on conflict(operation_key) do update set state='queued',error=null,available_at=now() where ff_research_jobs.state in ('held','done');
end $$;
create function public.ff_research_verify_file(p_file uuid,p_state text,p_error text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; f ff_research_files;
begin
  if p_state not in ('ready','held','failed') then raise exception 'Invalid verification state.'; end if;
  select * into f from ff_research_files where id=p_file;
  select * into c from ff_research_conversations where id=f.conversation_id for share;
  if c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then p_state:='held';p_error:='Collection closed before file verification.';end if;
  update ff_research_files set state=p_state,error=left(p_error,1000),updated_at=now() where id=p_file and state='checking';
  update ff_research_conversations set updated_at=now() where id=f.conversation_id;
end $$;
revoke all on function public.ff_research_reserve_file(uuid,text,text,bigint,text,text),public.ff_research_finalize_file(uuid,uuid),public.ff_research_verify_file(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ff_research_reserve_file(uuid,text,text,bigint,text,text),public.ff_research_finalize_file(uuid,uuid),public.ff_research_verify_file(uuid,text,text) to service_role;
commit;
