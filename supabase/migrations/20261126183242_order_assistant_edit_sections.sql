-- Null keeps existing chats readable and requires a fresh launch before writing.
alter table public.ff_order_assistant_contexts
  add column edit_section text check (edit_section in ('broadcast','digital'));
alter table public.ff_order_assistant_chat_scopes
  add column edit_section text check (edit_section in ('broadcast','digital'));

create or replace function public.ff_order_assistant_bind_chat(p_actor uuid,p_context uuid,p_session text)
returns void language plpgsql security invoker set search_path='' as $$
declare context public.ff_order_assistant_contexts; bound_order uuid; bound_section text;
begin
  if not exists(select from public.ff_members where user_id=p_actor) then
    raise exception 'Membership required.' using errcode='42501'; end if;
  select * into context from public.ff_order_assistant_contexts where id=p_context and user_id=p_actor;
  if context.id is null or context.expires_at<=now() then raise exception 'Context not found.' using errcode='PT404'; end if;
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then raise exception 'Conversation scope required.' using errcode='PT400'; end if;
  insert into public.ff_order_assistant_chat_scopes(user_id,session_hash,order_id,edit_section)
    values(p_actor,p_session,context.order_id,context.edit_section)
    on conflict do nothing;
  select order_id,edit_section into bound_order,bound_section
    from public.ff_order_assistant_chat_scopes where user_id=p_actor and session_hash=p_session;
  if bound_order is distinct from context.order_id or bound_section is distinct from context.edit_section then
    raise exception 'Start a new chat from this side of the order.' using errcode='PT409'; end if;
end $$;

create or replace function public.ff_order_assistant_apply(p_actor uuid,p_proposal uuid,p_hash text,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  stored public.ff_order_assistant_proposals;
  context public.ff_order_assistant_contexts;
  draft public.ff_order_drafts;
  research public.ff_order_research_state;
  personal public.ff_order_view_state;
  result jsonb;
  change_section text;
  protected_lines jsonpath;
begin
  if not exists(select from public.ff_members where user_id=p_actor) then
    raise exception 'Membership required.' using errcode='42501'; end if;
  select * into stored from public.ff_order_assistant_proposals where id=p_proposal and user_id=p_actor for update;
  if not found then raise exception 'Proposal not found.' using errcode='PT404'; end if;
  select * into context from public.ff_order_assistant_contexts where id=stored.context_id and user_id=p_actor for share;
  if context.id is null or context.detached or context.expires_at<=now() or context.order_id<>stored.order_id then
    raise exception 'Reopen this market to apply changes.' using errcode='PT409'; end if;
  if stored.proposal->>'hash' is distinct from p_hash then raise exception 'Proposal changed.' using errcode='PT409'; end if;
  change_section := case stored.proposal#>>'{changes,sheet}'
    when 'digital' then 'digital' when 'tv' then 'broadcast' when 'radio' then 'broadcast' else null end;
  if context.edit_section is null or context.edit_section is distinct from change_section then
    raise exception 'This chat cannot edit that side of the order.' using errcode='PT400'; end if;
  protected_lines := case context.edit_section
    when 'digital' then '$.lines[*] ? (@.media != "Digital")'::jsonpath
    else '$.lines[*] ? (@.media == "Digital")'::jsonpath end;
  if jsonb_typeof(stored.proposal->'after'->'lines') is distinct from 'array' or
    ((stored.proposal->'before') - 'lines'::text) is distinct from ((stored.proposal->'after') - 'lines'::text) or
    jsonb_path_query_array(stored.proposal->'before',protected_lines) is distinct from
      jsonb_path_query_array(stored.proposal->'after',protected_lines) then
    raise exception 'The other side of the order and shared details must stay unchanged.' using errcode='PT400'; end if;
  if stored.applied_result is not null then return stored.applied_result; end if;
  -- Block imports and review inserts/updates during the generation check and draft write.
  lock table public.ff_broadcast_research_sheets,public.ff_broadcast_research_market_reviews in share mode;
  perform 1 from public.ff_records where id='directory' for share;
  select * into draft from public.ff_order_drafts where id=stored.order_id for update;
  select * into research from public.ff_order_research_state where order_id=stored.order_id for share;
  select * into personal from public.ff_order_view_state where order_id=stored.order_id and user_id=p_actor for share;
  if draft.client_id<>context.client_id or draft.year<>context.year or draft.workflow<>context.workflow or
    draft.market_ids<>array[context.market_id] or
    draft.revision is distinct from (stored.proposal#>>'{stamp,order}')::integer or
    coalesce(research.revision,0) is distinct from (stored.proposal#>>'{stamp,research}')::integer or
    coalesce(personal.revision,0) is distinct from (stored.proposal#>>'{stamp,view}')::integer or
    draft.document is distinct from stored.proposal->'before' or
    p_sources is distinct from public.ff_order_assistant_versions(context.market_id) or
    p_sources is distinct from stored.proposal#>'{stamp,sources,database}' then
    raise exception 'Order or research changed. Review an updated proposal.' using errcode='PT409'; end if;
  if exists(select from public.ff_order_issues where order_id=draft.id and revision=draft.revision) then
    raise exception 'Finalized orders are read-only.' using errcode='PT400'; end if;
  result:=public.ff_orders_command(p_actor,'saveOrder',jsonb_build_object('id',draft.id,'expectedRevision',draft.revision,
    'operationId',stored.operation_id,'document',stored.proposal->'after'));
  update public.ff_order_assistant_proposals set applied_result=result,
    proposal=proposal||jsonb_build_object('status','applied','resultRevision',(result->>'revision')::integer) where id=p_proposal;
  return result;
end $$;
