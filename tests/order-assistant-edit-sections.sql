-- Run only in an isolated database after the Orders and assistant migrations.
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.ff_members(user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

set local role service_role;
do $$
declare
  actor uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  market text := 'epic3-austin';
  order_id uuid;
  context_id uuid;
  other_context uuid;
  old_context uuid;
  proposal_id uuid;
  section text;
  sheet text;
  revision integer;
  sources jsonb;
  before_doc jsonb;
  after_doc jsonb;
  valid_after jsonb;
  draft jsonb;
  attempt text;
  approved_hash text := repeat('c',64);
  conversation text;
begin
  assert not has_function_privilege('authenticated','public.ff_order_assistant_apply(uuid,uuid,text,jsonb)','EXECUTE');
  draft := public.ff_orders_command(actor,'saveOrder',jsonb_build_object('clientId','epic3','year',2027,
    'marketIds',jsonb_build_array(market),'workflow','broadcast','expectedRevision',0,'operationId',gen_random_uuid(),
    'originKey','broadcast|epic3|2027|market|'||market,'document',
    '{"number":"SECTION-TEST","lines":[{"id":"tv","media":"TV","marketId":"epic3-austin","amount":10000},{"id":"digital","media":"Digital","marketId":"epic3-austin","amount":20000,"feeBasisPoints":1500}]}'::jsonb));
  order_id := (draft->>'id')::uuid;
  insert into public.ff_order_assistant_contexts(order_id,user_id,client_id,year,market_id,workflow)
    values(order_id,actor,'epic3',2027,market,'broadcast') returning id into old_context;
  assert (select jsonb_array_length(public.ff_orders_detail(order_id)->'document'->'lines')) = 2;
  sources := public.ff_order_assistant_versions(market);
  foreach section in array array['digital','broadcast'] loop
    sheet := case section when 'digital' then 'digital' else 'tv' end;
    insert into public.ff_order_assistant_contexts(order_id,user_id,client_id,year,market_id,workflow,edit_section)
      values(order_id,actor,'epic3',2027,market,'broadcast',section) returning id into context_id;
    insert into public.ff_order_assistant_contexts(order_id,user_id,client_id,year,market_id,workflow,edit_section)
      values(order_id,actor,'epic3',2027,market,'broadcast',case section when 'digital' then 'broadcast' else 'digital' end)
      returning id into other_context;
    conversation := case section when 'digital' then repeat('a',64) else repeat('b',64) end;
    perform public.ff_order_assistant_bind_chat(actor,context_id,conversation);
    begin
      perform public.ff_order_assistant_bind_chat(actor,other_context,conversation);
      raise exception 'Chat unexpectedly changed editing section';
    exception when sqlstate 'PT409' then null;
    end;
    draft := public.ff_orders_detail(order_id);
    revision := (draft->>'revision')::integer;
    before_doc := draft->'document';
    valid_after := jsonb_set(before_doc,
      case section when 'digital' then '{lines,1,amount}'::text[] else '{lines,0,amount}'::text[] end,'30000');
    foreach attempt in array array['unscoped','wrong-sheet','wrong-line','shared-header','valid'] loop
      proposal_id := gen_random_uuid();
      after_doc := case attempt
        when 'wrong-line' then jsonb_set(before_doc,
          case section when 'digital' then '{lines,0,amount}'::text[] else '{lines,1,amount}'::text[] end,'40000')
        when 'shared-header' then jsonb_set(valid_after,'{number}','"changed"')
        else valid_after end;
      insert into public.ff_order_assistant_proposals(id,context_id,order_id,user_id,operation_id,proposal)
        values(proposal_id,case attempt when 'unscoped' then old_context else context_id end,order_id,actor,gen_random_uuid(),
          jsonb_build_object('changes',jsonb_build_object('sheet',case when attempt='wrong-sheet' then
            case sheet when 'digital' then 'radio' else 'digital' end else sheet end),
            'hash',approved_hash,'before',before_doc,'after',after_doc,'stamp',jsonb_build_object(
              'order',revision,'research',0,'view',0,'sources',jsonb_build_object('database',sources))));
      if attempt='valid' then
        assert public.ff_order_assistant_apply(actor,proposal_id,approved_hash,sources)->'document' = valid_after;
        assert (public.ff_orders_detail(order_id)->>'revision')::integer = revision+1;
      else
        begin
          perform public.ff_order_assistant_apply(actor,proposal_id,approved_hash,sources);
          raise exception 'Unexpected write from % in the % context',attempt,section;
        exception when sqlstate 'PT400' then null;
        end;
        assert public.ff_orders_detail(order_id)->'document' = before_doc;
      end if;
    end loop;
  end loop;
  raise notice 'Both sections apply their own edits. Cross-section, old-context, and shared-header writes fail.';
end;
$$;
rollback;
