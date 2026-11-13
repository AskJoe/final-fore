-- Deploy only after approval. Tested separately from the working application database.
begin;
alter table public.ff_research_files
  add column upload_lease_token uuid,
  add column upload_lease_until timestamptz,
  add column upload_attempts integer not null default 0 check (upload_attempts >= 0),
  add column upload_available_at timestamptz not null default now(),
  add constraint research_upload_lease_pair check ((upload_lease_token is null) = (upload_lease_until is null));
create index research_portal_upload_due on public.ff_research_files(upload_available_at,created_at,id)
  where source='portal' and state in ('uploading','checking');

create function public.ff_research_claim_portal_upload(p_file uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare f ff_research_files; c ff_research_conversations;
begin
  select * into f from ff_research_files
    where source='portal' and state in ('uploading','checking')
      and (p_file is null or id=p_file)
      and (state='checking' or created_at<=now()-interval '2 minutes')
      and upload_available_at<=now() and (upload_lease_until is null or upload_lease_until<=now())
    order by upload_available_at,created_at,id for update skip locked limit 1;
  if f.id is null then return null; end if;
  select * into c from ff_research_conversations where id=f.conversation_id;
  if c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then
    update ff_research_files set state='held',error='Collection closed before file verification.',
      upload_lease_token=null,upload_lease_until=null,updated_at=now() where id=f.id returning * into f;
  elsif f.state='checking' and f.upload_attempts>=5 then
    update ff_research_files set state='failed',error='Verification could not finish after 5 attempts. Please retry this file.',
      upload_lease_token=null,upload_lease_until=null,updated_at=now() where id=f.id returning * into f;
  else
    update ff_research_files set upload_lease_token=gen_random_uuid(),upload_lease_until=now()+interval '3 minutes',
      upload_attempts=upload_attempts+case when state='checking' then 1 else 0 end,
      recovery_checked_at=now() where id=f.id returning * into f;
  end if;
  return to_jsonb(f);
end $$;

-- Promote a recovered, storage-complete reservation without dropping its existing lease.
create function public.ff_research_promote_portal_upload(p_file uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare f ff_research_files; c ff_research_conversations; v_conversation uuid;
begin
  select conversation_id into v_conversation from ff_research_files where id=p_file;
  select * into c from ff_research_conversations where id=v_conversation for share;
  select * into f from ff_research_files where id=p_file for update;
  if f.id is null or f.source<>'portal' or f.state<>'uploading' or f.upload_lease_token is distinct from p_lease
    or p_lease is null or f.upload_lease_until<=clock_timestamp() then return false; end if;
  if c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then
    update ff_research_files set state='held',error='Collection closed before file verification.',
      upload_lease_token=null,upload_lease_until=null,updated_at=now() where id=f.id;
    return false;
  end if;
  update ff_research_files set state='checking',error=null,upload_attempts=upload_attempts+1,updated_at=now() where id=f.id;
  return true;
end $$;

-- Every acknowledgement is fenced by both the exact lease token and its expiry.
create function public.ff_research_finish_portal_upload(p_file uuid,p_lease uuid,p_state text,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare f ff_research_files; c ff_research_conversations; v_conversation uuid; v_state text; v_error text;
begin
  if p_state is null or p_state not in ('ready','held','failed','retry','missing') then raise exception 'Invalid upload result.'; end if;
  select conversation_id into v_conversation from ff_research_files where id=p_file;
  select * into c from ff_research_conversations where id=v_conversation for share;
  select * into f from ff_research_files where id=p_file for update;
  if f.id is null or f.source<>'portal' or f.state not in ('uploading','checking') or p_lease is null
    or f.upload_lease_token is distinct from p_lease or f.upload_lease_until<=clock_timestamp() then return false; end if;
  if p_state='ready' and f.state<>'checking' then raise exception 'Verify the uploaded document first.'; end if;
  if p_state='missing' and f.state<>'uploading' then raise exception 'Only unfinished transfers may be missing.'; end if;
  v_state:=p_state; v_error:=left(p_error,1000);
  if c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then
    v_state:='held';v_error:='Collection closed before file verification.';
  elsif p_state in ('retry','missing') then
    if f.state='checking' and f.upload_attempts>=5 then
      v_state:='failed';v_error:='Verification could not finish after 5 attempts. Please retry this file.';
    elsif f.state='uploading' and f.created_at<=now()-interval '30 minutes' then
      v_state:='failed';v_error:=case when p_state='missing' then 'Upload did not finish. Please retry this file.' else 'Could not verify this stored upload. Please retry this file.' end;
    else
      v_state:=f.state;v_error:='Verification is temporarily unavailable. It will retry automatically.';
      if p_state='missing' then v_error:=null; end if;
    end if;
  end if;
  update ff_research_files set state=v_state,error=case when v_state='ready' then null else v_error end,
    upload_lease_token=null,upload_lease_until=null,
    upload_available_at=now()+make_interval(secs=>case when f.state='uploading' then 60 else least(300,15*power(2,greatest(0,f.upload_attempts-1)))::integer end),
    updated_at=now() where id=f.id;
  update ff_research_conversations set updated_at=now() where id=f.conversation_id;
  return true;
end $$;

-- Web finalization queues the file itself. It no longer needs the mail job queue.
create or replace function public.ff_research_finalize_file(p_conversation uuid,p_file uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; f ff_research_files;
begin
  select * into c from ff_research_conversations where id=p_conversation for share;
  if c.id is null or c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then raise exception using errcode='42501',message='Research collection is not open.'; end if;
  select * into f from ff_research_files where id=p_file and conversation_id=c.id for update;
  if f.id is null or f.source<>'portal' then raise exception using errcode='22023',message='File does not belong to this upload link.'; end if;
  if f.state in ('ready','held','checking') or f.upload_lease_until>now() then return; end if;
  update ff_research_files set state='checking',error=null,updated_at=now(),upload_available_at=now(),
    upload_attempts=0,upload_lease_token=null,upload_lease_until=null where id=f.id;
end $$;

-- Older/unleased callers cannot overwrite a portal worker's result. Email behavior is retained.
create or replace function public.ff_research_verify_file(p_file uuid,p_state text,p_error text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; f ff_research_files;
begin
  if p_state is null or p_state not in ('ready','held','failed') then raise exception 'Invalid verification state.'; end if;
  select * into f from ff_research_files where id=p_file;
  if f.source='portal' then raise exception using errcode='42501',message='Portal verification requires an upload lease.'; end if;
  select * into c from ff_research_conversations where id=f.conversation_id for share;
  if c.portal_state<>'open' or (c.expires_at is not null and c.expires_at<=now()) then p_state:='held';p_error:='Collection closed before file verification.';end if;
  update ff_research_files set state=p_state,error=left(p_error,1000),updated_at=now() where id=p_file and state='checking';
  update ff_research_conversations set updated_at=now() where id=f.conversation_id;
end $$;

create function public.ff_research_upload_queue_status() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('schemaVersion',1,
    'pending',count(*) filter(where state in ('uploading','checking')),
    'active',count(*) filter(where upload_lease_until>now()),
    'failed',count(*) filter(where state='failed'),
    'oldestPendingSeconds',coalesce(extract(epoch from now()-min(created_at) filter(where state in ('uploading','checking'))),0))
  from ff_research_files where source='portal';
$$;
revoke all on function public.ff_research_claim_portal_upload(uuid),public.ff_research_promote_portal_upload(uuid,uuid),public.ff_research_finish_portal_upload(uuid,uuid,text,text),public.ff_research_upload_queue_status() from public,anon,authenticated;
grant execute on function public.ff_research_claim_portal_upload(uuid),public.ff_research_promote_portal_upload(uuid,uuid),public.ff_research_finish_portal_upload(uuid,uuid,text,text),public.ff_research_upload_queue_status() to service_role;
-- CREATE OR REPLACE preserves the existing service-only permissions on the two older RPCs.
notify pgrst,'reload schema';
commit;
