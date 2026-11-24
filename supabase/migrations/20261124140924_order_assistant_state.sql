-- Prepared for review. Applying this migration to a live database requires approval.
begin;

-- Approved on 2026-11-24: row locks require UPDATE privilege on at least one column.
-- This permits version-column updates; it does not grant payload-column updates.
grant update(version) on public.ff_records to service_role;

alter table public.ff_broadcast_research_sheets add column assistant_version uuid not null default gen_random_uuid();
create function public.ff_order_research_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.content is distinct from old.content then new.assistant_version:=gen_random_uuid();
  else new.assistant_version:=old.assistant_version; end if;
  return new;
end $$;
create trigger ff_order_research_generation before update of content,assistant_version on public.ff_broadcast_research_sheets
for each row execute function public.ff_order_research_generation();
revoke all on function public.ff_order_research_generation() from public,anon,authenticated;
grant execute on function public.ff_order_research_generation() to service_role;

create table public.ff_order_research_state (
  order_id uuid primary key references public.ff_order_drafts(id),
  revision integer not null default 0 check (revision>=0),
  shortlist jsonb not null default '{}'::jsonb check (jsonb_typeof(shortlist)='object'),
  updated_at timestamptz not null default now()
);
create table public.ff_order_view_state (
  order_id uuid not null references public.ff_order_drafts(id),
  user_id uuid not null references auth.users(id),
  revision integer not null default 0 check (revision>=0),
  view jsonb,
  recovery jsonb,
  updated_at timestamptz not null default now(),
  primary key(order_id,user_id)
);
create table public.ff_order_assistant_contexts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ff_order_drafts(id),
  user_id uuid not null references auth.users(id),
  client_id text not null,
  year integer not null,
  market_id text not null,
  workflow text not null check (workflow in ('broadcast','digital')),
  detached boolean not null default false,
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now()
);
create table public.ff_order_assistant_proposals (
  id uuid primary key,
  context_id uuid not null references public.ff_order_assistant_contexts(id),
  order_id uuid not null references public.ff_order_drafts(id),
  user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  proposal jsonb not null check (jsonb_typeof(proposal)='object'),
  applied_result jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,operation_id)
);
create table public.ff_order_assistant_operations (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  primary key(actor_id,operation_id)
);
create table public.ff_order_assistant_chat_scopes (
  user_id uuid not null references auth.users(id),
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  order_id uuid not null references public.ff_order_drafts(id),
  primary key(user_id,session_hash)
);
alter table public.ff_order_assistant_chat_scopes enable row level security;
revoke all on public.ff_order_assistant_chat_scopes from public,anon,authenticated;
grant select,insert on public.ff_order_assistant_chat_scopes to service_role;
alter table public.ff_order_research_state enable row level security;
alter table public.ff_order_view_state enable row level security;
alter table public.ff_order_assistant_contexts enable row level security;
alter table public.ff_order_assistant_proposals enable row level security;
alter table public.ff_order_assistant_operations enable row level security;
revoke all on public.ff_order_research_state,public.ff_order_view_state,public.ff_order_assistant_contexts,
  public.ff_order_assistant_proposals,public.ff_order_assistant_operations from public,anon,authenticated;
grant select,insert,update on public.ff_order_research_state,public.ff_order_view_state,public.ff_order_assistant_contexts,
  public.ff_order_assistant_proposals to service_role;
grant select,insert on public.ff_order_assistant_operations to service_role;

create function public.ff_order_state_command(p_actor uuid,p_order uuid,p_action text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  draft public.ff_order_drafts;
  shared public.ff_order_research_state;
  personal public.ff_order_view_state;
  operation uuid:=nullif(p_input->>'operationId','')::uuid;
  fingerprint text:=encode(sha256(convert_to(jsonb_build_array(p_order,p_action,p_input-'sources')::text,'UTF8')),'hex');
  previous public.ff_order_assistant_operations;
  item jsonb; ids jsonb; result jsonb; sheet text:=p_input->>'sheet';
begin
  if not exists(select from public.ff_members where user_id=p_actor) then
    raise exception 'Membership required.' using errcode='42501'; end if;
  select * into draft from public.ff_order_drafts where id=p_order for share;
  if not found then raise exception 'Order not found.' using errcode='PT404'; end if;
  if p_action not in ('get','stars','view') then raise exception 'Invalid action.' using errcode='PT400'; end if;
  if p_action<>'get' then
    if operation is null then raise exception 'Operation required.' using errcode='PT400'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_actor::text||operation::text,0));
    select * into previous from public.ff_order_assistant_operations where actor_id=p_actor and operation_id=operation;
    if found then
      if previous.fingerprint<>fingerprint then raise exception 'Operation changed.' using errcode='PT409'; end if;
      return previous.result;
    end if;
  end if;
  if p_action='stars' then
    lock table public.ff_broadcast_research_sheets,public.ff_broadcast_research_market_reviews in share mode;
    perform 1 from public.ff_records where id='directory' for share;
    if p_input->'sources' is distinct from public.ff_order_assistant_versions(draft.market_ids[1]) then
      raise exception 'Research changed before the shortlist saved.' using errcode='PT409'; end if;
    if cardinality(draft.market_ids)<>1 or exists(select from public.ff_order_issues where order_id=p_order and revision=draft.revision) then
      raise exception 'Choose one editable market.' using errcode='PT400'; end if;
    if sheet not in ('tv','radio') or jsonb_typeof(p_input->'items') is distinct from 'array' or
      jsonb_array_length(p_input->'items') not between 1 and 100 then
      raise exception 'Choose valid quote rows.' using errcode='PT400'; end if;
    insert into public.ff_order_research_state(order_id) values(p_order) on conflict do nothing;
    select * into shared from public.ff_order_research_state where order_id=p_order for update;
    if shared.revision is distinct from (p_input->>'expectedRevision')::integer then
      raise exception 'Shortlist changed.' using errcode='PT409'; end if;
    ids:=coalesce(shared.shortlist->sheet,'[]'::jsonb);
    for item in select value from jsonb_array_elements(p_input->'items') loop
      if jsonb_typeof(item->'starred') is distinct from 'boolean' or length(item->>'rowId') not between 1 and 400 then
        raise exception 'Invalid quote state.' using errcode='PT400'; end if;
      ids:=coalesce((select jsonb_agg(value) from jsonb_array_elements(ids) where value<>item->'rowId'),'[]'::jsonb);
      if (item->>'starred')::boolean then ids:=ids||jsonb_build_array(item->>'rowId'); end if;
    end loop;
    if jsonb_array_length(ids)>5000 then raise exception 'Shortlist is too large.' using errcode='PT400'; end if;
    update public.ff_order_research_state set shortlist=jsonb_set(shortlist,array[sheet],ids),
      revision=revision+1,updated_at=now() where order_id=p_order;
  elsif p_action='view' then
    if jsonb_typeof(p_input->'view') is distinct from 'object' or octet_length(p_input::text)>1000000 then
      raise exception 'Invalid view state.' using errcode='PT400'; end if;
    insert into public.ff_order_view_state(order_id,user_id) values(p_order,p_actor) on conflict do nothing;
    select * into personal from public.ff_order_view_state where order_id=p_order and user_id=p_actor for update;
    if personal.revision is distinct from (p_input->>'expectedRevision')::integer then
      raise exception 'View changed in another window.' using errcode='PT409'; end if;
    update public.ff_order_view_state set view=p_input->'view',recovery=nullif(p_input->'recovery','null'::jsonb),
      revision=revision+1,updated_at=now() where order_id=p_order and user_id=p_actor;
  end if;
  select * into shared from public.ff_order_research_state where order_id=p_order;
  select * into personal from public.ff_order_view_state where order_id=p_order and user_id=p_actor;
  result:=jsonb_build_object('orderId',p_order,'revision',coalesce(shared.revision,0),'shortlist',coalesce(shared.shortlist,'{}'::jsonb),
    'viewRevision',coalesce(personal.revision,0),'view',personal.view,'recovery',personal.recovery);
  if p_action<>'get' then insert into public.ff_order_assistant_operations values(p_actor,operation,fingerprint,result); end if;
  return result;
end $$;

-- Authoritative generations, including review assignments and directory mappings.
create function public.ff_order_assistant_versions(p_market text) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object(
    'sheets',coalesce((select jsonb_agg(jsonb_build_array(batch_key,sheet,imported_at,assistant_version) order by batch_key,sheet)
      from public.ff_broadcast_research_sheets),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(jsonb_build_array(batch_key,review_key,market_id,reviewed_at) order by batch_key,review_key)
      from public.ff_broadcast_research_market_reviews where market_id=p_market),'[]'::jsonb),
    'directory',coalesce((select version from public.ff_records where id='directory'),0))
$$;

create function public.ff_order_assistant_bind_chat(p_actor uuid,p_context uuid,p_session text)
returns void language plpgsql security invoker set search_path='' as $$
declare context public.ff_order_assistant_contexts; bound uuid;
begin
  if not exists(select from public.ff_members where user_id=p_actor) then
    raise exception 'Membership required.' using errcode='42501'; end if;
  select * into context from public.ff_order_assistant_contexts where id=p_context and user_id=p_actor;
  if context.id is null or context.expires_at<=now() then raise exception 'Context not found.' using errcode='PT404'; end if;
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then raise exception 'Conversation scope required.' using errcode='PT400'; end if;
  insert into public.ff_order_assistant_chat_scopes(user_id,session_hash,order_id) values(p_actor,p_session,context.order_id)
    on conflict do nothing;
  select order_id into bound from public.ff_order_assistant_chat_scopes where user_id=p_actor and session_hash=p_session;
  if bound is distinct from context.order_id then
    raise exception 'Start a new chat for this market and order.' using errcode='PT409'; end if;
end $$;

create function public.ff_order_assistant_apply(p_actor uuid,p_proposal uuid,p_hash text,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  stored public.ff_order_assistant_proposals;
  context public.ff_order_assistant_contexts;
  draft public.ff_order_drafts;
  research public.ff_order_research_state;
  personal public.ff_order_view_state;
  result jsonb;
begin
  if not exists(select from public.ff_members where user_id=p_actor) then
    raise exception 'Membership required.' using errcode='42501'; end if;
  select * into stored from public.ff_order_assistant_proposals where id=p_proposal and user_id=p_actor for update;
  if not found then raise exception 'Proposal not found.' using errcode='PT404'; end if;
  select * into context from public.ff_order_assistant_contexts where id=stored.context_id and user_id=p_actor for share;
  if context.id is null or context.detached or context.expires_at<=now() or context.order_id<>stored.order_id then
    raise exception 'Reopen this market to apply changes.' using errcode='PT409'; end if;
  if stored.proposal->>'hash' is distinct from p_hash then raise exception 'Proposal changed.' using errcode='PT409'; end if;
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

revoke all on function public.ff_order_state_command(uuid,uuid,text,jsonb),
  public.ff_order_assistant_versions(text),public.ff_order_assistant_apply(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ff_order_state_command(uuid,uuid,text,jsonb),
  public.ff_order_assistant_versions(text),public.ff_order_assistant_apply(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.ff_order_assistant_bind_chat(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ff_order_assistant_bind_chat(uuid,uuid,text) to service_role;
commit;
