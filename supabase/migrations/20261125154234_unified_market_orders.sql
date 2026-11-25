-- A market order may satisfy any placement deadline in the same client, year and market.
create or replace function public.ff_order_link_eligible(
  p_deadline public.ff_order_deadlines,p_calendar public.ff_order_calendars,p_order public.ff_order_drafts
) returns boolean language sql stable set search_path='' as $$
  select p_order.client_id=p_calendar.client_id and p_order.year=p_calendar.year
    and p_deadline.market_id=any(p_order.market_ids) and (
      p_deadline.step='copy'
      or p_deadline.step='digital' and p_order.workflow='digital'
      or p_order.workflow='broadcast' and p_deadline.step in ('tv','radio','digital') and (
        (cardinality(p_order.market_ids)=1 and
          p_order.origin_key=concat_ws('|','broadcast',p_calendar.client_id,p_calendar.year,'market',p_deadline.market_id))
        or (p_deadline.step in ('tv','radio') and (
          jsonb_array_length(p_order.document->'lines')=0 or exists (
            select 1 from jsonb_array_elements(p_order.document->'lines') as placement
            where lower(placement->>'media')=p_deadline.step
          )
        ))
      )
    );
$$;

-- Retain the existing review, membership, revision and source checks for Digital shortlists.
create or replace function public.ff_order_state_command(p_actor uuid,p_order uuid,p_action text,p_input jsonb default '{}'::jsonb)
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
    if sheet is null or sheet not in ('tv','radio','digital') or jsonb_typeof(p_input->'items') is distinct from 'array' or
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
