-- REVIEW ARTIFACT ONLY. Not applied. Atomic email attachment deduplication and separate provenance.
begin;
create table public.ff_research_attachment_sources (
  source_id text primary key,
  file_id uuid not null references public.ff_research_files(id),
  filename text not null,
  created_at timestamptz not null default now()
);
alter table public.ff_research_attachment_sources enable row level security;
revoke all on public.ff_research_attachment_sources from public,anon,authenticated;
grant all on public.ff_research_attachment_sources to service_role;
create function public.ff_research_reserve_attachment(p_conversation uuid,p_source text,p_market text,p_name text,p_size bigint,p_hash text,p_type text,p_uploader text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations;f ff_research_files;v_id uuid:=gen_random_uuid();
begin
  select * into c from ff_research_conversations where id=p_conversation for update;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  if p_market is not null and not exists(select 1 from jsonb_array_elements(c.manifest->'markets') m where m->>'marketId'=p_market) then raise exception 'Attachment market is outside this template.'; end if;
  select files.* into f from ff_research_attachment_sources s join ff_research_files files on files.id=s.file_id where s.source_id=p_source;
  if f.id is not null then
    if f.conversation_id<>c.id or f.sha256<>p_hash then raise exception using errcode='PT409',message='Incoming attachment identity changed.'; end if;
    return to_jsonb(f);
  end if;
  select * into f from ff_research_files where conversation_id=c.id and market_id is not distinct from p_market and sha256=p_hash and source='email' and duplicate_of is null;
  if f.id is null then
    insert into ff_research_files(id,conversation_id,market_id,name,size,sha256,content_type,object_key,state,source,source_attachment_id,uploader,error)
      values(v_id,c.id,p_market,p_name,p_size,p_hash,p_type,c.id::text||'/'||v_id::text,case when p_size=0 then 'held' else 'checking' end,'email',p_source,p_uploader,case when p_size=0 then 'Empty email attachment.' else null end) returning * into f;
  end if;
  insert into ff_research_attachment_sources(source_id,file_id,filename) values(p_source,f.id,p_name);
  return to_jsonb(f);
end $$;
revoke all on function public.ff_research_reserve_attachment(uuid,text,text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.ff_research_reserve_attachment(uuid,text,text,text,bigint,text,text,text) to service_role;
commit;
