-- Upload-only draft previews. No email messages or deliveries are created.
begin;
alter table public.ff_research_conversations alter column template_version_id drop not null;
alter table public.ff_research_conversations add constraint research_live_version_required check(mode='preview' or template_version_id is not null);
create function public.ff_research_start_upload_test(p_member uuid,p_copy jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_key text:=p_copy->'manifest'->>'uploadTestKey'; v_cipher text;
begin
  if not exists(select 1 from ff_members where user_id=p_member) then raise exception using errcode='42501',message='Membership required.'; end if;
  if v_key is null or v_key !~ '^[a-f0-9]{64}$' or jsonb_array_length(p_copy->'manifest'->'markets')<1 then raise exception using errcode='22023',message='Invalid test collection.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('upload-test:'||p_member::text||':'||v_key,0));
  select c.id,s.ciphertext into v_id,v_cipher from ff_research_conversations c join ff_research_secrets s on s.conversation_id=c.id
    where c.created_by=p_member and c.mode='preview' and c.manifest->>'uploadTestKey'=v_key and c.expires_at>now() order by c.created_at desc limit 1;
  if v_id is not null then return jsonb_build_object('ciphertext',v_cipher); end if;
  v_id:=(p_copy->>'id')::uuid;
  insert into ff_research_conversations(id,manifest,recipient,mode,expires_at,created_by)
    values(v_id,p_copy->'manifest',p_copy->'recipient','preview',now()+interval '24 hours',p_member);
  insert into ff_research_secrets values(v_id,p_copy->>'portalHash',p_copy->>'externalReplyHash',p_copy->>'staffReplyHash',p_copy->>'secrets');
  return jsonb_build_object('ciphertext',p_copy->>'secrets');
end $$;
revoke all on function public.ff_research_start_upload_test(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ff_research_start_upload_test(uuid,jsonb) to service_role;
commit;
