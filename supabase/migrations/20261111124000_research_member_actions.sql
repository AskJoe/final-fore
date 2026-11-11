-- REVIEW ARTIFACT ONLY. Not applied. Member actions retain immutable conversation manifests.
begin;
create table public.ff_research_reply_operations (
  member_id uuid not null references auth.users(id),
  operation_key uuid not null,
  conversation_id uuid not null references public.ff_research_conversations(id),
  message_id uuid not null references public.ff_research_messages(id),
  body_text text not null,
  primary key(member_id,operation_key)
);
alter table public.ff_research_reply_operations enable row level security;
revoke all on public.ff_research_reply_operations from public,anon,authenticated;
grant all on public.ff_research_reply_operations to service_role;

create function public.ff_research_reply(p_member uuid,p_conversation uuid,p_key uuid,p_subject text,p_text text,p_dispatch jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; op ff_research_reply_operations; v_message uuid;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if length(trim(p_text)) not between 1 and 50000 then raise exception 'Enter a reply.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-reply:'||p_member::text||':'||p_key::text,0));
  select * into op from ff_research_reply_operations where member_id=p_member and operation_key=p_key;
  if op.message_id is not null then
    if op.body_text<>p_text or op.conversation_id<>p_conversation then raise exception using errcode='PT409',message='Reply operation changed.'; end if;
    return op.message_id;
  end if;
  select * into c from ff_research_conversations where id=p_conversation and mode='live' for update;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  insert into ff_research_messages(conversation_id,author_kind,sender,subject,body_text)
    values(c.id,'staff','Final Fore',p_subject,p_text) returning id into v_message;
  insert into ff_research_deliveries(message_id,leg,idempotency_key,payload_ciphertext)
    values(v_message,'vendor','research/'||v_message::text||'/vendor',p_dispatch->>'vendor'),
          (v_message,'gmail','research/'||v_message::text||'/gmail',p_dispatch->>'gmail');
  insert into ff_research_reply_operations values(p_member,p_key,c.id,v_message,p_text);
  update ff_research_conversations set updated_at=now() where id=c.id;
  return v_message;
end $$;
create function public.ff_research_mark_read(p_member uuid,p_conversation uuid,p_through timestamptz) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if not exists(select 1 from ff_research_conversations where id=p_conversation and mode='live') or p_through>now() then raise exception 'Invalid read marker.'; end if;
  insert into ff_research_reads(member_id,conversation_id,read_at) values(p_member,p_conversation,p_through)
    on conflict(member_id,conversation_id) do update set read_at=greatest(ff_research_reads.read_at,excluded.read_at);
end $$;
create function public.ff_research_assign_file(p_member uuid,p_file uuid,p_market text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare f ff_research_files; c ff_research_conversations; v_duplicate uuid;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  select * into f from ff_research_files where id=p_file;
  select * into c from ff_research_conversations where id=f.conversation_id and mode='live' for update;
  select * into f from ff_research_files where id=p_file for update;
  if f.id is null or c.id is null or f.source<>'email' or f.market_id is not null then raise exception using errcode='PT409',message='File is already assigned or unavailable.'; end if;
  if not exists(select 1 from jsonb_array_elements(c.manifest->'markets') m where m->>'marketId'=p_market) then raise exception 'Market is outside this template.'; end if;
  select id into v_duplicate from ff_research_files where conversation_id=c.id and market_id=p_market and sha256=f.sha256 and source='email' and duplicate_of is null and id<>f.id;
  -- Preserve the original object/message association; don't delete bytes on duplicate assignment.
  update ff_research_files set market_id=p_market,duplicate_of=v_duplicate,updated_at=now() where id=f.id;
  update ff_research_conversations set updated_at=now() where id=c.id;
end $$;
create function public.ff_research_set_portal_state(p_member uuid,p_conversation uuid,p_state text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if p_state not in ('open','closed') then raise exception 'Invalid collection state.'; end if;
  update ff_research_conversations set portal_state=p_state,updated_at=now() where id=p_conversation and mode='live' and portal_state<>'revoked';
  if not found then raise exception 'Collection not available.'; end if;
end $$;
revoke all on function public.ff_research_reply(uuid,uuid,uuid,text,text,jsonb),public.ff_research_mark_read(uuid,uuid,timestamptz),public.ff_research_assign_file(uuid,uuid,text),public.ff_research_set_portal_state(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ff_research_reply(uuid,uuid,uuid,text,text,jsonb),public.ff_research_mark_read(uuid,uuid,timestamptz),public.ff_research_assign_file(uuid,uuid,text),public.ff_research_set_portal_state(uuid,uuid,text) to service_role;
commit;
