-- Test messages only. No vendor/Gmail-copy deliveries; service-only, member-owned collections.
begin;
create table public.ff_research_test_send_operations (
  member_id uuid not null references auth.users(id),
  operation_key uuid not null,
  fingerprint text not null,
  conversation_id uuid not null references public.ff_research_conversations(id),
  delivery_id uuid not null references public.ff_research_deliveries(id),
  recipients jsonb not null,
  primary key(member_id,operation_key)
);
alter table public.ff_research_test_send_operations enable row level security;
revoke all on public.ff_research_test_send_operations from public,anon,authenticated;
grant all on public.ff_research_test_send_operations to service_role;
create function public.ff_research_queue_test_email(p_member uuid,p_key uuid,p_conversation uuid,p_fingerprint text,p_copy jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare op ff_research_test_send_operations; c ff_research_conversations; message_id uuid; delivery_id uuid;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_copy->'recipients') is distinct from 'array' then raise exception using errcode='22023',message='Invalid test recipients.'; end if;
  if jsonb_array_length(p_copy->'recipients') not between 1 and 10 then raise exception using errcode='22023',message='Choose 1-10 test recipients.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('test-email:'||p_member::text||':'||p_key::text,0));
  select * into op from ff_research_test_send_operations where member_id=p_member and operation_key=p_key;
  if op.delivery_id is not null then
    if op.fingerprint<>p_fingerprint or op.conversation_id<>p_conversation or op.recipients is distinct from p_copy->'recipients' then raise exception using errcode='PT409',message='Test operation changed.'; end if;
    return jsonb_build_object('deliveryId',op.delivery_id);
  end if;
  select * into c from ff_research_conversations where id=p_conversation for share;
  if c.id is null or c.created_by<>p_member or c.mode<>'preview' or c.manifest->>'uploadTestKey' is null or c.expires_at<=now() or c.portal_state<>'open' then raise exception using errcode='42501',message='Open your own test collection.'; end if;
  insert into ff_research_messages(conversation_id,author_kind,sender,subject,body_text,body_html)
    values(c.id,'staff',p_copy->>'sender',p_copy->>'subject',p_copy->>'text',p_copy->>'html') returning id into message_id;
  insert into ff_research_deliveries(message_id,leg,idempotency_key,payload_ciphertext)
    values(message_id,'preview','research/'||message_id::text||'/test',p_copy->>'dispatch') returning id into delivery_id;
  insert into ff_research_test_send_operations values(p_member,p_key,p_fingerprint,c.id,delivery_id,p_copy->'recipients');
  return jsonb_build_object('deliveryId',delivery_id);
end $$;
revoke all on function public.ff_research_queue_test_email(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ff_research_queue_test_email(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
