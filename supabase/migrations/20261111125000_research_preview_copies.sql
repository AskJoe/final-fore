-- REVIEW ARTIFACT ONLY. Not applied. Test deliveries never create live incoming files.
begin;
create table public.ff_research_preview_operations (
  member_id uuid not null references auth.users(id),operation_key uuid not null,
  original_id uuid not null references public.ff_research_previews(id),render_hash text not null,recipient text not null,
  conversation_id uuid not null references public.ff_research_conversations(id),portal_url text not null,
  primary key(member_id,operation_key)
);
alter table public.ff_research_preview_operations enable row level security;
revoke all on public.ff_research_preview_operations from public,anon,authenticated;
grant all on public.ff_research_preview_operations to service_role;
create function public.ff_research_queue_preview_copy(p_member uuid,p_key uuid,p_copy jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare op ff_research_preview_operations; original ff_research_previews; v_id uuid:=(p_copy->>'id')::uuid; v_message uuid;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-preview:'||p_member::text||':'||p_key::text,0));
  select * into op from ff_research_preview_operations where member_id=p_member and operation_key=p_key;
  if op.conversation_id is not null then
    if op.original_id<>(p_copy->>'originalId')::uuid or op.render_hash<>p_copy->>'originalHash' or op.recipient<>p_copy->>'to' then raise exception using errcode='PT409',message='Preview operation changed.'; end if;
    return jsonb_build_object('conversationId',op.conversation_id,'portalUrl',op.portal_url);
  end if;
  select * into original from ff_research_previews where id=(p_copy->>'originalId')::uuid and member_id=p_member for share;
  if original.id is null or original.expires_at<=now() or original.payload->'email'->>'renderHash'<>p_copy->>'originalHash'
    or original.payload->'manifest'->'markets' is distinct from p_copy->'manifest'->'markets'
    or original.payload->'email'->'missing'<>'[]'::jsonb then raise exception using errcode='PT409',message='Preview changed or expired.'; end if;
  insert into ff_research_conversations(id,template_version_id,manifest,recipient,mode,expires_at,created_by)
    values(v_id,original.version_id,p_copy->'manifest',p_copy->'recipient','preview',least((p_copy->>'expiresAt')::timestamptz,now()+interval '24 hours'),p_member);
  insert into ff_research_secrets values(v_id,p_copy->>'portalHash',p_copy->>'externalReplyHash',p_copy->>'staffReplyHash',p_copy->>'secrets');
  insert into ff_research_messages(conversation_id,author_kind,sender,subject,body_text,body_html)
    values(v_id,'staff','Preview',p_copy->'email'->>'subject',p_copy->'email'->>'text',p_copy->'email'->>'html') returning id into v_message;
  insert into ff_research_deliveries(message_id,leg,idempotency_key,payload_ciphertext)
    values(v_message,'preview','research/'||v_message::text||'/preview',p_copy->>'dispatch');
  insert into ff_research_preview_operations values(p_member,p_key,original.id,p_copy->>'originalHash',p_copy->>'to',v_id,p_copy->>'portalUrl');
  return jsonb_build_object('conversationId',v_id,'portalUrl',p_copy->>'portalUrl');
end $$;
revoke all on function public.ff_research_queue_preview_copy(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ff_research_queue_preview_copy(uuid,uuid,jsonb) to service_role;
commit;
