-- REVIEW ARTIFACT ONLY. Not applied.
begin;
alter table public.ff_research_messages add column raw_object_key text;
alter table public.ff_research_messages add column authentication jsonb;
create table public.ff_research_reads (
  member_id uuid not null references auth.users(id),
  conversation_id uuid not null references public.ff_research_conversations(id),
  read_at timestamptz not null default now(),
  primary key(member_id,conversation_id)
);
alter table public.ff_research_reads enable row level security;
revoke all on public.ff_research_reads from anon,authenticated;
grant select on public.ff_research_reads to authenticated;
grant all on public.ff_research_reads to service_role;
create policy research_reads_own on public.ff_research_reads for select to authenticated using(member_id=auth.uid() and exists(select 1 from ff_members where user_id=auth.uid()));

create function public.ff_research_append_message(p_conversation uuid,p_message jsonb,p_deliveries jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare c ff_research_conversations; v_id uuid; d jsonb;
begin
  select * into c from ff_research_conversations where id=p_conversation for update;
  if c.id is null then raise exception 'Conversation not available.'; end if;
  select id into v_id from ff_research_messages where received_email_id=p_message->>'receivedEmailId';
  if v_id is not null and exists(select 1 from ff_research_messages where id=v_id and state<>'processing') then return v_id; end if;
  if v_id is null then
  insert into ff_research_messages(conversation_id,author_kind,sender,subject,body_text,body_html,original_message_id,received_email_id,state,hold_reason,attachment_ids,raw_object_key,authentication)
    values(c.id,p_message->>'authorKind',p_message->>'sender',p_message->>'subject',p_message->>'text',p_message->>'html',p_message->>'messageId',p_message->>'receivedEmailId',p_message->>'state',p_message->>'holdReason',coalesce(p_message->'attachmentIds','[]'),p_message->>'rawObjectKey',p_message->'authentication') returning id into v_id;
  else
    update ff_research_messages set body_text=p_message->>'text',body_html=p_message->>'html',state=p_message->>'state',hold_reason=p_message->>'holdReason',attachment_ids=coalesce(p_message->'attachmentIds','[]'),raw_object_key=p_message->>'rawObjectKey',authentication=p_message->'authentication' where id=v_id;
  end if;
  if p_message->>'state' in ('recorded','held') then
    for d in select value from jsonb_array_elements(p_deliveries) loop
      if p_message->>'state'='held' and d->>'leg'<>'gmail' then raise exception 'Held messages cannot be relayed to vendors.'; end if;
      insert into ff_research_deliveries(message_id,leg,idempotency_key,payload_ciphertext)
        values(v_id,d->>'leg','research/'||v_id::text||'/'||(d->>'leg'),d->>'ciphertext');
    end loop;
  end if;
  update ff_research_conversations set updated_at=now() where id=c.id;
  return v_id;
end $$;
create function public.ff_research_apply_delivery_event(p_provider text,p_type text,p_rfc_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d ff_research_deliveries; v_state text;
begin
  select * into d from ff_research_deliveries where provider_id=p_provider for update;
  if d.id is null then raise exception 'Delivery not linked yet; retry event.'; end if;
  v_state:=case p_type when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.failed' then 'failed' when 'email.suppressed' then 'failed' when 'email.sent' then 'sent' else d.state end;
  if d.state='bounced' or (d.state='delivered' and v_state not in ('bounced','failed')) then v_state:=d.state; end if;
  update ff_research_deliveries set state=v_state,rfc_message_id=coalesce(nullif(p_rfc_id,''),rfc_message_id),updated_at=now() where id=d.id;
end $$;
create function public.ff_research_renew_job(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update ff_research_jobs set lease_until=now()+interval '5 minutes' where id=p_id and lease_token=p_lease and lease_until>now();
  if not found then raise exception using errcode='PT409',message='Job lease expired.'; end if;
end $$;
revoke all on function public.ff_research_append_message(uuid,jsonb,jsonb),public.ff_research_apply_delivery_event(text,text,text),public.ff_research_renew_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ff_research_append_message(uuid,jsonb,jsonb),public.ff_research_apply_delivery_event(text,text,text),public.ff_research_renew_job(uuid,uuid) to service_role;
commit;
