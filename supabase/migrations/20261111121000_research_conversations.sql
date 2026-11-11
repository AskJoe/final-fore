-- REVIEW ARTIFACT ONLY. Not applied. Requires explicit database approval.
begin;
create table public.ff_research_previews (
  id uuid primary key,
  member_id uuid not null references auth.users(id),
  version_id uuid not null references public.ff_research_template_versions(id),
  expires_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now()
);
create table public.ff_research_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id),
  operation_key uuid not null,
  preview_refs jsonb not null,
  created_at timestamptz not null default now(),
  unique(member_id,operation_key)
);
create table public.ff_research_conversations (
  id uuid primary key,
  request_id uuid references public.ff_research_requests(id),
  template_version_id uuid not null references public.ff_research_template_versions(id),
  manifest jsonb not null,
  recipient jsonb not null,
  mode text not null default 'live' check(mode in ('live','preview')),
  expires_at timestamptz,
  constraint research_preview_expiry check(mode<>'preview' or expires_at is not null),
  portal_state text not null default 'open' check(portal_state in ('open','closed','revoked')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ff_research_secrets (
  conversation_id uuid primary key references public.ff_research_conversations(id),
  portal_hash text not null unique,
  external_reply_hash text not null unique,
  staff_reply_hash text not null unique,
  ciphertext text not null
);
create table public.ff_research_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ff_research_conversations(id),
  author_kind text not null check(author_kind in ('staff','rep','system')),
  sender text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  original_message_id text,
  received_email_id text unique,
  state text not null default 'recorded' check(state in ('recorded','held','processing')),
  hold_reason text,
  attachment_ids jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index research_messages_conversation on public.ff_research_messages(conversation_id,created_at,id);
create table public.ff_research_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ff_research_messages(id),
  leg text not null check(leg in ('vendor','gmail','preview')),
  idempotency_key text not null unique,
  payload_ciphertext text not null,
  state text not null default 'queued' check(state in ('queued','sending','retry','uncertain','sent','delivered','bounced','failed','needs-review')),
  provider_id text unique,
  rfc_message_id text,
  first_attempt_at timestamptz,
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(message_id,leg)
);
create index research_deliveries_due on public.ff_research_deliveries(available_at) where state in ('queued','retry','uncertain','sending');
create table public.ff_research_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.ff_research_jobs (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  kind text not null check(kind in ('receive','event','verify-file')),
  payload jsonb not null,
  state text not null default 'queued' check(state in ('queued','working','retry','done','held')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index research_jobs_due on public.ff_research_jobs(available_at) where state in ('queued','working','retry');

-- All mutations and private transport data are server-only. User APIs validate membership.
do $$ declare t text; begin
  foreach t in array array['ff_research_previews','ff_research_requests','ff_research_conversations','ff_research_secrets','ff_research_messages','ff_research_deliveries','ff_research_events','ff_research_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.ff_research_conversations, public.ff_research_messages to authenticated;
create policy research_conversations_read on public.ff_research_conversations for select to authenticated
 using(exists(select 1 from public.ff_members where user_id=auth.uid()));
create policy research_messages_read on public.ff_research_messages for select to authenticated
 using(exists(select 1 from public.ff_members where user_id=auth.uid()));

create function public.ff_research_prepare_preview(p_preview jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version public.ff_research_template_versions; v_current public.ff_research_templates; v_directory public.ff_records; v_assignment bigint;
begin
  if not exists(select 1 from ff_members where user_id=(p_preview->>'memberId')::uuid) then raise exception using errcode='42501',message='Membership required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-assignments',0));
  select revision into v_assignment from ff_research_assignments where rep_id=p_preview->'recipient'->>'repId' and template_id=p_preview->>'templateId';
  if coalesce(v_assignment,0)<>coalesce((p_preview->>'assignmentRevision')::bigint,0) then raise exception using errcode='PT409',message='Coverage changed. Review again.'; end if;
  select * into v_directory from ff_records where id='directory' for share;
  if v_directory.version is distinct from (p_preview->>'directoryRevision')::bigint then raise exception using errcode='PT409',message='Directory changed. Review again.'; end if;
  select * into v_version from ff_research_template_versions where id=(p_preview->>'versionId')::uuid;
  select * into v_current from ff_research_templates where id=v_version.template_id for share;
  if v_version.id is null or v_current.payload->>'status'<>'published'
    or v_current.revision is distinct from (p_preview->>'templateRevision')::bigint
    or v_version.payload->'markets' is distinct from p_preview->'manifest'->'markets'
    or v_version.payload->>'clientId' is distinct from p_preview->'manifest'->>'clientId' then
    raise exception using errcode='PT409',message='Published template changed. Review again.';
  end if;
  insert into ff_research_previews(id,member_id,version_id,expires_at,payload)
    values((p_preview->>'id')::uuid,(p_preview->>'memberId')::uuid,v_version.id,(p_preview->>'expiresAt')::timestamptz,p_preview);
end $$;

create function public.ff_research_queue_batch(p_member uuid,p_key uuid,p_refs jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request ff_research_requests; v_row ff_research_previews; v_directory ff_records; v_template ff_research_templates;
  v_refs jsonb; v_ids jsonb:='[]'; v_seen text[]:=array[]::text[]; v_group text; v_message uuid; v_assignment bigint;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if jsonb_typeof(p_refs) is distinct from 'array' or jsonb_array_length(p_refs) not between 1 and 100 then raise exception using errcode='22023',message='Choose reviewed previews.'; end if;
  select jsonb_agg(x order by x->>'previewId') into v_refs from jsonb_array_elements(p_refs) x;
  if (select count(distinct x->>'previewId') from jsonb_array_elements(v_refs) x)<>jsonb_array_length(v_refs) then raise exception using errcode='22023',message='Duplicate preview.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-send:'||p_member::text||':'||p_key::text,0));
  select * into v_request from ff_research_requests where member_id=p_member and operation_key=p_key;
  if v_request.id is not null then
    if v_request.preview_refs<>v_refs then raise exception using errcode='PT409',message='Send operation changed.'; end if;
    select jsonb_agg(id order by id) into v_ids from ff_research_conversations where request_id=v_request.id;
    return jsonb_build_object('requestId',v_request.id,'conversationIds',v_ids);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('research-assignments',0));
  select * into v_directory from ff_records where id='directory' for share;
  if (select count(*) from ff_research_previews where id in(select (x->>'previewId')::uuid from jsonb_array_elements(v_refs) x) and member_id=p_member)<>jsonb_array_length(v_refs) then raise exception using errcode='42501',message='Preview not available.'; end if;
  insert into ff_research_requests(member_id,operation_key,preview_refs) values(p_member,p_key,v_refs) returning * into v_request;
  for v_row in select * from ff_research_previews where id in(select (x->>'previewId')::uuid from jsonb_array_elements(v_refs) x) order by id for update loop
    if v_row.expires_at<=now() or v_row.payload->'email'->'missing'<>'[]'::jsonb then raise exception using errcode='22023',message='Preview expired or has missing fields.'; end if;
    if not exists(select 1 from jsonb_array_elements(v_refs) x where x->>'previewId'=v_row.id::text and x->>'renderHash'=v_row.payload->'email'->>'renderHash') then raise exception using errcode='PT409',message='Preview changed.'; end if;
    if v_directory.version is distinct from (v_row.payload->>'directoryRevision')::bigint then raise exception using errcode='PT409',message='Directory changed. Review again.'; end if;
    select revision into v_assignment from ff_research_assignments where rep_id=v_row.payload->'recipient'->>'repId' and template_id=v_row.payload->>'templateId';
    if coalesce(v_assignment,0)<>coalesce((v_row.payload->>'assignmentRevision')::bigint,0) then raise exception using errcode='PT409',message='Coverage changed. Review again.'; end if;
    select * into v_template from ff_research_templates where id=v_row.payload->>'templateId' for share;
    if v_template.revision is distinct from (v_row.payload->>'templateRevision')::bigint or v_template.payload->>'status'<>'published' then raise exception using errcode='PT409',message='Template changed. Review again.'; end if;
    select string_agg(lower(address),',' order by lower(address)) into v_group from (
      select v_row.payload->'recipient'->>'to' address union select jsonb_array_elements_text(v_row.payload->'recipient'->'cc')) addresses;
    v_group:=v_row.version_id::text||':'||(v_row.payload->'recipient'->>'firmId')||':'||v_group;
    if v_group=any(v_seen) then raise exception using errcode='22023',message='Duplicate recipient group.'; end if;
    v_seen:=array_append(v_seen,v_group);
    insert into ff_research_conversations(id,request_id,template_version_id,manifest,recipient,created_by)
      values(v_row.id,v_request.id,v_row.version_id,v_row.payload->'manifest',v_row.payload->'recipient',p_member);
    insert into ff_research_secrets values(v_row.id,v_row.payload->>'portalHash',v_row.payload->>'externalReplyHash',v_row.payload->>'staffReplyHash',v_row.payload->>'secrets');
    insert into ff_research_messages(conversation_id,author_kind,sender,subject,body_text,body_html)
      values(v_row.id,'staff','Sarah',v_row.payload->'email'->>'subject',v_row.payload->'email'->>'text',v_row.payload->'email'->>'html') returning id into v_message;
    insert into ff_research_deliveries(message_id,leg,idempotency_key,payload_ciphertext)
      values(v_message,'vendor','research/'||v_message::text||'/vendor',v_row.payload->'dispatch'->>'vendor'),
            (v_message,'gmail','research/'||v_message::text||'/gmail',v_row.payload->'dispatch'->>'gmail');
    v_ids:=v_ids||jsonb_build_array(v_row.id);
  end loop;
  return jsonb_build_object('requestId',v_request.id,'conversationIds',v_ids);
end $$;

create function public.ff_research_claim_delivery(p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r ff_research_deliveries;
begin
  select * into r from ff_research_deliveries where id=p_id and available_at<=now() and (lease_until is null or lease_until<now()) for update skip locked;
  if r.id is null then return null; end if;
  update ff_research_deliveries set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=r.id returning * into r;
  return to_jsonb(r);
end $$;
create function public.ff_research_delivery_attempt(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update ff_research_deliveries set first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1,state='sending',updated_at=now()
    where id=p_id and lease_token=p_lease and lease_until>now();
  if not found then raise exception using errcode='PT409',message='Delivery lease expired.'; end if;
end $$;
create function public.ff_research_finish_delivery(p_id uuid,p_lease uuid,p_state text,p_provider_id text,p_error text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update ff_research_deliveries set state=case when state in ('delivered','bounced') then state when attempts>=12 and p_state in ('retry','uncertain') then 'needs-review' else p_state end,
    provider_id=coalesce(p_provider_id,provider_id),error=left(p_error,1000),lease_token=null,lease_until=null,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer),updated_at=now()
    where id=p_id and lease_token=p_lease;
  if not found then raise exception using errcode='PT409',message='Delivery lease changed.'; end if;
end $$;
create function public.ff_research_accept_event(p_id text,p_type text,p_payload jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into ff_research_events(id,type,payload) values(p_id,p_type,p_payload) on conflict do nothing;
  if not found then return false; end if;
  insert into ff_research_jobs(operation_key,kind,payload) values('event:'||p_id,case when p_type='email.received' then 'receive' else 'event' end,p_payload) on conflict do nothing;
  return true;
end $$;
create function public.ff_research_claim_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r ff_research_jobs;
begin
  select * into r from ff_research_jobs where state in ('queued','retry','working') and available_at<=now() and (lease_until is null or lease_until<now()) order by available_at,id limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update ff_research_jobs set state='working',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=r.id returning * into r;
  return to_jsonb(r);
end $$;
create function public.ff_research_finish_job(p_id uuid,p_lease uuid,p_error text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update ff_research_jobs set state=case when p_error is null then 'done' when attempts>=12 then 'held' else 'retry' end,
    error=left(p_error,1000),lease_token=null,lease_until=null,available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
    where id=p_id and lease_token=p_lease;
  if not found then raise exception using errcode='PT409',message='Job lease changed.'; end if;
end $$;
revoke all on function public.ff_research_prepare_preview(jsonb),public.ff_research_queue_batch(uuid,uuid,jsonb),public.ff_research_claim_delivery(uuid),public.ff_research_delivery_attempt(uuid,uuid),public.ff_research_finish_delivery(uuid,uuid,text,text,text),public.ff_research_accept_event(text,text,jsonb),public.ff_research_claim_job(),public.ff_research_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ff_research_prepare_preview(jsonb),public.ff_research_queue_batch(uuid,uuid,jsonb),public.ff_research_claim_delivery(uuid),public.ff_research_delivery_attempt(uuid,uuid),public.ff_research_finish_delivery(uuid,uuid,text,text,text),public.ff_research_accept_event(text,text,jsonb),public.ff_research_claim_job(),public.ff_research_finish_job(uuid,uuid,text) to service_role;
commit;
