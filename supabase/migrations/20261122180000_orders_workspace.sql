begin;

create table public.ff_order_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  year integer not null check (year between 2000 and 2100),
  market_ids text[] not null check (cardinality(market_ids) between 1 and 100),
  workflow text not null check (workflow in ('broadcast','digital')),
  origin_key text,
  firm_id text,
  rep_id text,
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  seed jsonb check (jsonb_typeof(seed) = 'object'),
  updated_at timestamptz not null default now(),
  unique (client_id,year,workflow,origin_key)
);
create index ff_order_drafts_workspace on public.ff_order_drafts(client_id,year,updated_at desc,id);

create table public.ff_order_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ff_order_drafts(id),
  revision integer not null,
  storage_key text not null unique check (length(storage_key) between 1 and 350),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null check (bytes between 1 and 10485760),
  template_version text not null check (length(template_version) between 1 and 100),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  issued_at timestamptz not null default now(),
  unique (order_id,revision),
  unique (order_id,id)
);

create table public.ff_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ff_order_drafts(id),
  type text not null check (type in ('saved','finalized','downloaded','sent','sendCorrected')),
  revision integer not null,
  issue_id uuid,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  corrects_event_id uuid references public.ff_order_events(id),
  foreign key (order_id,issue_id) references public.ff_order_issues(order_id,id),
  check ((type = 'saved') = (issue_id is null)),
  check ((type = 'sendCorrected') = (corrects_event_id is not null)),
  unique (corrects_event_id)
);
create index ff_order_events_order_time on public.ff_order_events(order_id,created_at desc,id);
create index ff_order_events_issue_type on public.ff_order_events(issue_id,type);

create table public.ff_order_calendars (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  year integer not null check (year between 2000 and 2100),
  name text not null check (length(name) between 1 and 150),
  revision integer not null default 1
);
create index ff_order_calendars_workspace on public.ff_order_calendars(client_id,year,id);

create table public.ff_order_deadlines (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.ff_order_calendars(id),
  market_id text not null,
  step text not null check (step in ('tv','radio','digital','copy')),
  due_date date not null,
  revision integer not null default 1,
  status_override text check (status_override in ('Not started','In progress','Complete','Not doing','Needs decision')),
  legacy_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(legacy_refs) = 'array'),
  copy_sent_at timestamptz,
  copy_sent_note text,
  unique (calendar_id,market_id,step)
);
create index ff_order_deadlines_calendar_date on public.ff_order_deadlines(calendar_id,due_date,id);

create table public.ff_order_deadline_links (
  deadline_id uuid not null references public.ff_order_deadlines(id),
  order_id uuid not null references public.ff_order_drafts(id),
  primary key (deadline_id,order_id)
);
create index ff_order_deadline_links_order on public.ff_order_deadline_links(order_id);

create table public.ff_order_operations (
  actor_id uuid not null,
  operation_id text not null,
  action text not null,
  fingerprint text not null,
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_id,operation_id)
);

alter table public.ff_order_drafts enable row level security;
alter table public.ff_order_issues enable row level security;
alter table public.ff_order_events enable row level security;
alter table public.ff_order_calendars enable row level security;
alter table public.ff_order_deadlines enable row level security;
alter table public.ff_order_deadline_links enable row level security;
alter table public.ff_order_operations enable row level security;
revoke all on public.ff_order_drafts,public.ff_order_issues,public.ff_order_events,public.ff_order_calendars,
  public.ff_order_deadlines,public.ff_order_deadline_links,public.ff_order_operations from public,anon,authenticated,service_role;
grant select,insert,update on public.ff_order_drafts,public.ff_order_calendars,public.ff_order_deadlines to service_role;
grant select,insert on public.ff_order_issues,public.ff_order_events,public.ff_order_operations to service_role;
grant select,insert,delete on public.ff_order_deadline_links to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ff-order-pdfs','ff-order-pdfs',false,10485760,array['application/pdf'])
on conflict (id) do nothing;
do $$
begin
  if not exists (
    select 1 from storage.buckets where id='ff-order-pdfs' and not public
      and file_size_limit=10485760 and allowed_mime_types=array['application/pdf']
  ) then
    raise exception 'Existing order PDF bucket differs from the private configuration.';
  end if;
end;
$$;
create policy ff_order_pdf_server_only on storage.objects as restrictive for all to anon,authenticated
using (bucket_id <> 'ff-order-pdfs') with check (bucket_id <> 'ff-order-pdfs');

create function public.ff_order_issue_summary(p_issue public.ff_order_issues) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',p_issue.id,'revision',p_issue.revision,'issuedAt',p_issue.issued_at,'sha256',p_issue.sha256,
    'bytes',p_issue.bytes,'templateVersion',p_issue.template_version,'storageKey',p_issue.storage_key,
    'number',p_issue.document->>'number',
    'downloaded',exists(select 1 from public.ff_order_events e where e.issue_id=p_issue.id and e.type='downloaded'),
    'sent',exists(select 1 from public.ff_order_events e where e.issue_id=p_issue.id and e.type='sent'
      and not exists(select 1 from public.ff_order_events c where c.corrects_event_id=e.id))
  );
$$;

create function public.ff_order_summary(p_order public.ff_order_drafts) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',p_order.id,'clientId',p_order.client_id,'year',p_order.year,'marketIds',p_order.market_ids,
    'workflow',p_order.workflow,'revision',p_order.revision,'originKey',p_order.origin_key,
    'firmId',p_order.firm_id,'repId',p_order.rep_id,'number',p_order.document->>'number',
    'vendor',p_order.document->>'vendor','updatedAt',p_order.updated_at,
    'media',coalesce((select jsonb_agg(distinct value->>'media') from jsonb_array_elements(p_order.document->'lines')), '[]'::jsonb),
    'currentIssue',issue,'downloaded',coalesce((issue->>'downloaded')::boolean,false),
    'sent',coalesce((issue->>'sent')::boolean,false)
  ) from (
    select (select public.ff_order_issue_summary(i) from public.ff_order_issues i
      where i.order_id=p_order.id and i.revision=p_order.revision) as issue
  ) as current_issue;
$$;

create function public.ff_orders_detail(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select public.ff_order_summary(o) || jsonb_build_object(
    'document',o.document,'seed',o.seed,
    'issues',coalesce((select jsonb_agg(public.ff_order_issue_summary(i) order by i.revision desc)
      from public.ff_order_issues i where i.order_id=o.id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'type',e.type,'revision',e.revision,'issueId',e.issue_id,'actorId',e.actor_id,
      'createdAt',e.created_at,'detail',e.detail
    ) order by e.created_at desc,e.id) from public.ff_order_events e where e.order_id=o.id),'[]'::jsonb)
  ) from public.ff_order_drafts o where o.id=p_id;
$$;

create function public.ff_order_deadline_detail(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'id',d.id,'calendarId',d.calendar_id,'revision',d.revision,'marketId',d.market_id,'step',d.step,
    'dueDate',d.due_date,'statusOverride',d.status_override,'copySentAt',d.copy_sent_at,
    'orderIds',coalesce(links.order_ids,'[]'::jsonb),'legacyRefs',d.legacy_refs,
    'status',coalesce(d.status_override,case
      when d.step='copy' and d.copy_sent_at is not null then 'Complete'
      when d.step<>'copy' and jsonb_array_length(d.legacy_refs)=0 and links.order_ids is not null and links.sent then 'Complete'
      when links.order_ids is not null or jsonb_array_length(d.legacy_refs)>0 then 'In progress'
      else 'Not started' end)
  ) from public.ff_order_deadlines d
  cross join lateral (
    select jsonb_agg(o.id order by o.id) as order_ids,
      bool_and(exists(select 1 from public.ff_order_issues i join public.ff_order_events s on s.issue_id=i.id
        where i.order_id=o.id and i.revision=o.revision and s.type='sent'
        and not exists(select 1 from public.ff_order_events c where c.corrects_event_id=s.id))) as sent
    from public.ff_order_deadline_links l join public.ff_order_drafts o on o.id=l.order_id
    where l.deadline_id=d.id
  ) links where d.id=p_id;
$$;

create function public.ff_order_calendar_detail(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',c.id,'clientId',c.client_id,'year',c.year,'name',c.name,'revision',c.revision,
    'deadlines',coalesce((select jsonb_agg(public.ff_order_deadline_detail(d.id) order by d.due_date,d.id)
      from public.ff_order_deadlines d where d.calendar_id=c.id),'[]'::jsonb))
  from public.ff_order_calendars c where c.id=p_id;
$$;

create function public.ff_orders_workspace(p_client_id text,p_year integer) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'calendars',coalesce((select jsonb_agg(public.ff_order_calendar_detail(c.id) order by c.name,c.id)
      from public.ff_order_calendars c where c.client_id=p_client_id and c.year=p_year),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(public.ff_order_summary(o) order by o.updated_at desc,o.id)
      from public.ff_order_drafts o where o.client_id=p_client_id and o.year=p_year),'[]'::jsonb)
  );
$$;

create function public.ff_order_link_eligible(
  p_deadline public.ff_order_deadlines,p_calendar public.ff_order_calendars,p_order public.ff_order_drafts
) returns boolean language sql stable set search_path='' as $$
  select p_order.client_id=p_calendar.client_id and p_order.year=p_calendar.year
    and p_deadline.market_id=any(p_order.market_ids) and (
      p_deadline.step='copy'
      or p_deadline.step='digital' and p_order.workflow='digital'
      or p_deadline.step in ('tv','radio') and p_order.workflow='broadcast' and (
        jsonb_array_length(p_order.document->'lines')=0 or exists (
          select 1 from jsonb_array_elements(p_order.document->'lines') as placement
          where lower(placement->>'media')=p_deadline.step
        )
      )
    );
$$;

create function public.ff_orders_command(p_actor_id uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
  operation text := p_input->>'operationId';
  fingerprint text := encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
  target uuid := nullif(p_input->>'id','')::uuid;
  expected integer := (p_input->>'expectedRevision')::integer;
  result_id uuid;
  existing public.ff_order_operations%rowtype;
  draft public.ff_order_drafts%rowtype;
  preceding public.ff_order_drafts%rowtype;
  issue public.ff_order_issues%rowtype;
  event public.ff_order_events%rowtype;
  cal public.ff_order_calendars%rowtype;
  deadline public.ff_order_deadlines%rowtype;
  next_document jsonb;
  next_markets text[];
  linked_deadline_id uuid;
  linked_id uuid;
  copied_at timestamptz;
  report jsonb;
begin
  if p_actor_id is null or not exists (select 1 from public.ff_members where user_id=p_actor_id) then
    raise exception 'Orders access denied.' using errcode='42501';
  end if;
  if not coalesce(length(operation) between 1 and 100,false) then
    raise exception 'A valid operation ID is required.' using errcode='PT400';
  end if;

  -- One operation ID per actor. Serialize retries before reading the receipt.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || '/' || operation,0));
  select * into existing from public.ff_order_operations where actor_id=p_actor_id and operation_id=operation;
  if found then
    if existing.action<>p_action or existing.fingerprint<>fingerprint then
      raise exception 'This operation ID was already used for different details.' using errcode='PT409';
    end if;
    result_id := existing.result_id;
  elsif p_action='saveCalendar' then
    if not coalesce(length(trim(p_input->>'name')) between 1 and 150,false) then
      raise exception 'Enter a calendar name.' using errcode='PT400';
    end if;
    if target is null and expected=0 then
      insert into public.ff_order_calendars(client_id,year,name)
      values (p_input->>'clientId',(p_input->>'year')::integer,trim(p_input->>'name'))
      returning id into result_id;
    else
      update public.ff_order_calendars set name=trim(p_input->>'name'),revision=revision+1
      where id=target and revision=expected returning id into result_id;
    end if;
  elsif p_action='saveMarketDeadlines' then
    select * into cal from public.ff_order_calendars where id=(p_input->>'calendarId')::uuid for update;
    if not found then raise exception 'Calendar not found.' using errcode='PT404'; end if;
    if nullif(p_input->>'marketId','') is null or p_input->>'dueDate' is null then
      raise exception 'Choose a market and due date.' using errcode='PT400';
    end if;
    insert into public.ff_order_deadlines(calendar_id,market_id,step,due_date)
    select cal.id,p_input->>'marketId',step,(p_input->>'dueDate')::date
    from unnest(array['tv','radio','digital','copy']) as steps(step)
    on conflict (calendar_id,market_id,step) do nothing;
    result_id := cal.id;
  elsif p_action in ('saveDeadline','recordCopySend') then
    if target is not null then
      select * into deadline from public.ff_order_deadlines where id=target for update;
      if not found then raise exception 'Deadline not found.' using errcode='PT404'; end if;
      if expected is distinct from deadline.revision then raise exception 'Deadline changed.' using errcode='PT409'; end if;
    end if;
    if p_action='recordCopySend' then
      if target is null or deadline.step<>'copy' then
        raise exception 'Choose an ad-copy deadline.' using errcode='PT400';
      end if;
      copied_at := (p_input->>'sentAt')::timestamptz;
      if copied_at>now() then raise exception 'Ad-copy send time must be in the past.' using errcode='PT400'; end if;
      update public.ff_order_deadlines set copy_sent_at=copied_at, copy_sent_note=p_input->>'note',revision=revision+1
      where id=target returning id into result_id;
    else
      select * into cal from public.ff_order_calendars where id=(p_input->>'calendarId')::uuid;
      if not found then raise exception 'Calendar not found.' using errcode='PT404'; end if;
      if target is null and expected=0 then
        insert into public.ff_order_deadlines(calendar_id,market_id,step,due_date,status_override,legacy_refs)
        values (cal.id,p_input->>'marketId',p_input->>'step',(p_input->>'dueDate')::date,
          p_input->>'statusOverride',coalesce(p_input->'legacyRefs','[]'::jsonb))
        returning * into deadline;
      elsif target is not null and deadline.calendar_id=cal.id then
        if deadline.market_id is distinct from (p_input->>'marketId') or deadline.step is distinct from (p_input->>'step') then
          raise exception 'Choose the deadline’s original market and step.' using errcode='PT400';
        end if;
        update public.ff_order_deadlines set due_date=(p_input->>'dueDate')::date,
          status_override=case when p_input ? 'statusOverride' then p_input->>'statusOverride' else status_override end,
          legacy_refs=coalesce(p_input->'legacyRefs',legacy_refs),revision=revision+1 where id=target returning * into deadline;
      end if;
      result_id := deadline.id;
      if result_id is not null and p_input ? 'orderIds' then
        if jsonb_typeof(p_input->'orderIds')<>'array' or jsonb_array_length(p_input->'orderIds')>100 then
          raise exception 'Choose up to 100 linked orders.' using errcode='PT400';
        end if;
        delete from public.ff_order_deadline_links as links where links.deadline_id=result_id;
        for linked_id in select distinct value::uuid from jsonb_array_elements_text(p_input->'orderIds') order by 1 loop
          select * into draft from public.ff_order_drafts where id=linked_id for update;
          if not found or not public.ff_order_link_eligible(deadline,cal,draft) then
            raise exception 'Order and deadline must match by client, year, market and workflow.' using errcode='PT400';
          end if;
          insert into public.ff_order_deadline_links(deadline_id,order_id) values (result_id,linked_id);
        end loop;
      end if;
    end if;
  elsif p_action in ('saveOrder','createRevision','reviseOrder','restoreRevision','finalizeOrder','recordDownload','recordSend','correctSend') then
    if p_action='saveOrder' and nullif(p_input->>'deadlineId','') is not null then
      linked_deadline_id := (p_input->>'deadlineId')::uuid;
      select * into deadline from public.ff_order_deadlines where id=linked_deadline_id for update;
      if not found then raise exception 'Deadline not found.' using errcode='PT404'; end if;
      if deadline.revision is distinct from (p_input->>'deadlineRevision')::integer then
        raise exception 'Deadline changed.' using errcode='PT409';
      end if;
      select * into cal from public.ff_order_calendars where id=deadline.calendar_id;
    end if;
    if target is not null then
      select * into draft from public.ff_order_drafts where id=target for update;
      if not found then raise exception 'Order not found.' using errcode='PT404'; end if;
    end if;

    if p_action='saveOrder' and target is null then
      if expected is distinct from 0 then raise exception 'Order changed.' using errcode='PT409'; end if;
      select array_agg(value order by ordinal) into next_markets
      from jsonb_array_elements_text(p_input->'marketIds') with ordinality as scope(value,ordinal);
      insert into public.ff_order_drafts (client_id,year,market_ids,workflow,origin_key,firm_id,rep_id,revision,document,seed)
      values (p_input->>'clientId',(p_input->>'year')::integer,next_markets,p_input->>'workflow',
        nullif(p_input->>'originKey',''),nullif(p_input->>'firmId',''),nullif(p_input->>'repId',''),1,
        p_input->'document',nullif(p_input->'seed','null'::jsonb))
      returning * into draft;
      insert into public.ff_order_events(order_id,type,revision,actor_id,detail)
      values (draft.id,'saved',draft.revision,p_actor_id,jsonb_build_object('before',null,'after',draft.document));
    elsif p_action in ('saveOrder','createRevision','reviseOrder','restoreRevision','finalizeOrder') then
      if target is null then raise exception 'Choose an order.' using errcode='PT400'; end if;
      if expected is distinct from draft.revision then raise exception 'Order changed.' using errcode='PT409'; end if;
      select * into issue from public.ff_order_issues where order_id=target and revision=draft.revision;

      if p_action='finalizeOrder' then
        if issue.id is null then
          insert into public.ff_order_issues (order_id,revision,storage_key,sha256,bytes,template_version,document)
          values (target,draft.revision,p_input#>>'{artifact,storageKey}',p_input#>>'{artifact,sha256}',
            (p_input#>>'{artifact,bytes}')::integer,p_input#>>'{artifact,templateVersion}',draft.document) returning * into issue;
          insert into public.ff_order_events(order_id,type,revision,issue_id,actor_id)
          values (target,'finalized',issue.revision,issue.id,p_actor_id);
        end if;
      else
        preceding := draft;
        next_document := draft.document;
        if p_action in ('createRevision','reviseOrder') then
          if issue.id is null then raise exception 'Only a finalized order needs a new draft revision.' using errcode='PT400'; end if;
        elsif issue.id is not null then
          raise exception 'Create a new draft revision before changing a finalized order.' using errcode='PT409';
        elsif p_action='restoreRevision' then
          select * into event from public.ff_order_events where id=(p_input->>'eventId')::uuid and order_id=target and type='saved';
          if not found then raise exception 'Order revision not found.' using errcode='PT404'; end if;
          next_document := event.detail->'after';
        else
          next_document := p_input->'document';
        end if;
        if p_action<>'saveOrder' or next_document is distinct from preceding.document or
          (p_input ? 'firmId' and nullif(p_input->>'firmId','') is distinct from preceding.firm_id) or
          (p_input ? 'repId' and nullif(p_input->>'repId','') is distinct from preceding.rep_id)
        then
          update public.ff_order_drafts set document=next_document,revision=revision+1,updated_at=now(),
            firm_id=case when p_action='saveOrder' and p_input ? 'firmId' then nullif(p_input->>'firmId','') else firm_id end,
            rep_id=case when p_action='saveOrder' and p_input ? 'repId' then nullif(p_input->>'repId','') else rep_id end
          where id=target returning * into draft;
          if exists (
            select 1 from public.ff_order_deadline_links l
            join public.ff_order_deadlines d on d.id=l.deadline_id
            join public.ff_order_calendars c on c.id=d.calendar_id
            where l.order_id=target and not public.ff_order_link_eligible(d,c,draft)
          ) then
            raise exception 'Update the order’s deadline links before changing its media.' using errcode='PT400';
          end if;
          insert into public.ff_order_events(order_id,type,revision,actor_id,detail)
          values (target,'saved',draft.revision,p_actor_id,
            jsonb_build_object('before',preceding.document,'after',draft.document,'action',p_action));
        end if;
      end if;
    else
      select * into issue from public.ff_order_issues where id=(p_input->>'issueId')::uuid and order_id=target;
      if not found then raise exception 'Issued order not found.' using errcode='PT404'; end if;
      if p_action='recordDownload' then
        insert into public.ff_order_events(order_id,type,revision,issue_id,actor_id)
        values (target,'downloaded',issue.revision,issue.id,p_actor_id);
      elsif p_action='recordSend' then
        if not coalesce(length(trim(p_input->>'recipient')) between 1 and 320,false)
          or (p_input->>'sentAt')::timestamptz is null
          or (p_input->>'sentAt')::timestamptz>now() then
          raise exception 'Enter the recipient and a valid past send time.' using errcode='PT400';
        end if;
        insert into public.ff_order_events(order_id,type,revision,issue_id,actor_id,detail)
        values (target,'sent',issue.revision,issue.id,p_actor_id,
          jsonb_build_object('recipient',trim(p_input->>'recipient'),'sentAt',p_input->>'sentAt','note',p_input->>'note'));
      else
        select * into event from public.ff_order_events
        where id=(p_input->>'sendEventId')::uuid and issue_id=issue.id and type='sent';
        if not found then raise exception 'Send record not found.' using errcode='PT404'; end if;
        insert into public.ff_order_events(order_id,type,revision,issue_id,actor_id,detail,corrects_event_id)
        values (target,'sendCorrected',issue.revision,issue.id,p_actor_id,
          jsonb_build_object('sendEventId',event.id,'note',p_input->>'note'),event.id);
      end if;
    end if;

    result_id := draft.id;
    if linked_deadline_id is not null then
      if not public.ff_order_link_eligible(deadline,cal,draft) then
        raise exception 'Order and deadline must match by client, year, market and workflow.' using errcode='PT400';
      end if;
      insert into public.ff_order_deadline_links(deadline_id,order_id) values (linked_deadline_id,draft.id) on conflict do nothing;
      if found then update public.ff_order_deadlines set revision=revision+1 where id=linked_deadline_id; end if;
    end if;
  else
    raise exception 'Choose a supported Orders action.' using errcode='PT400';
  end if;

  if result_id is null then raise exception 'Order workspace changed.' using errcode='PT409'; end if;
  if existing.actor_id is null then
    insert into public.ff_order_operations (actor_id,operation_id,action,fingerprint,result_id)
    values (p_actor_id,operation,p_action,fingerprint,result_id);
  end if;
  if p_action in ('saveCalendar','saveMarketDeadlines') then report := public.ff_order_calendar_detail(result_id);
  elsif p_action in ('saveDeadline','recordCopySend') then report := public.ff_order_deadline_detail(result_id);
  else report := public.ff_orders_detail(result_id);
  end if;
  return report;
end;
$$;

revoke all on function public.ff_order_issue_summary(public.ff_order_issues), public.ff_order_summary(public.ff_order_drafts),
  public.ff_orders_detail(uuid), public.ff_order_deadline_detail(uuid), public.ff_order_calendar_detail(uuid),
  public.ff_orders_workspace(text,integer),
  public.ff_order_link_eligible(public.ff_order_deadlines,public.ff_order_calendars,public.ff_order_drafts),
  public.ff_orders_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ff_order_issue_summary(public.ff_order_issues), public.ff_order_summary(public.ff_order_drafts),
  public.ff_orders_detail(uuid), public.ff_order_deadline_detail(uuid), public.ff_order_calendar_detail(uuid),
  public.ff_orders_workspace(text,integer),
  public.ff_order_link_eligible(public.ff_order_deadlines,public.ff_order_calendars,public.ff_order_drafts),
  public.ff_orders_command(uuid,text,jsonb) to service_role;

commit;
