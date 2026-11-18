-- Keep the original Radio endpoints available to the previous Render release.
create function public.ff_radio_workbook_page(p_batch text, p_market text, p_client text, p_rep text,
  p_firm text, p_primary text, p_secondary text, p_page integer) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  page jsonb := ff_radio_page(p_batch,p_market,p_client,p_rep,p_firm,p_primary,p_secondary,p_page);
  ids integer[]; entries jsonb[]; resolved jsonb;
begin
  if page is null then return null; end if;
  select array_agg(i.id::integer order by l.n,i.pos) into ids
    from jsonb_array_elements(page->'lines') with ordinality l(line,n)
    cross join lateral jsonb_array_elements_text(l.line) with ordinality i(id,pos);
  -- Reuse the bounded indexed lookup inside this statement. A monthly line
  -- may span many observations, but still takes a single client round trip.
  select array_agg(e.entry order by start_at,e.pos) into entries
    from generate_series(1,cardinality(ids),100) start_at cross join lateral
      jsonb_array_elements(ff_radio_entries(page->>'version',ids[start_at:start_at+99])) with ordinality e(entry,pos);
  if cardinality(entries) is distinct from cardinality(ids) then raise exception 'Incomplete radio page'; end if;
  select jsonb_agg(to_jsonb(entries[finish-size+1:finish]) order by n) into resolved from (
    select n,jsonb_array_length(line) size,(sum(jsonb_array_length(line)) over(order by n))::integer finish
    from jsonb_array_elements(page->'lines') with ordinality l(line,n)
  ) lengths;
  return (page - 'version') || jsonb_build_object('lines',coalesce(resolved,'[]'::jsonb));
end $$;

-- The TV projection belongs to the source snapshot. Moving a staged batch into
-- place moves its index too. Content replacements rebuild it in the same transaction.
create table public.ff_tv_catalog (
  batch_key text primary key, sheet text not null default 'tv' check(sheet='tv'),
  header jsonb not null, fields jsonb not null, options jsonb not null, total integer not null,
  foreign key(batch_key,sheet) references public.ff_broadcast_research_sheets(batch_key,sheet) on update cascade on delete cascade
);
create table public.ff_tv_sources (
  batch_key text not null references public.ff_tv_catalog on update cascade on delete cascade,
  source integer not null, files jsonb not null, rep text not null, firm text not null,
  primary key(batch_key,source)
);
create table public.ff_tv_rows (
  batch_key text not null, ordinal integer not null, source integer not null,
  market text not null, client text not null, issue_key text, body jsonb not null,
  primary key(batch_key,ordinal),
  foreign key(batch_key,source) references public.ff_tv_sources on update cascade on delete cascade
);
create index ff_tv_market_page on public.ff_tv_rows(batch_key,market,ordinal);
create index ff_tv_review_key on public.ff_tv_rows(batch_key,issue_key) where issue_key is not null;
alter table public.ff_tv_catalog enable row level security;
alter table public.ff_tv_sources enable row level security;
alter table public.ff_tv_rows enable row level security;
create policy ff_tv_catalog_read on public.ff_tv_catalog for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
create policy ff_tv_sources_read on public.ff_tv_sources for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
create policy ff_tv_rows_read on public.ff_tv_rows for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
revoke all on public.ff_tv_catalog, public.ff_tv_sources, public.ff_tv_rows from public, anon, authenticated;
grant select on public.ff_tv_catalog, public.ff_tv_sources, public.ff_tv_rows to authenticated;
grant select,insert,update,delete on public.ff_tv_catalog, public.ff_tv_sources, public.ff_tv_rows to service_role;

create function public.ff_index_tv(p_batch text, doc jsonb) returns void language plpgsql
security invoker set search_path = public, pg_temp as $$
declare
  source_map jsonb; source_docs jsonb := doc->'sources'; fields jsonb;
begin
  delete from ff_tv_catalog where batch_key=p_batch;
  if not (doc ? 'columns' and doc ? 'rows') then return; end if;
  with bands as (
    select b->>'label' label, row_number() over (order by band,pos) as n
    from jsonb_array_elements(doc->'groups') with ordinality t(b,band)
    cross join lateral generate_series(1,(b->>'span')::int) pos
  ), labels as (
    select n, concat_ws(' · ',nullif(bands.label,''),c->>'label') label
    from jsonb_array_elements(doc->'columns') with ordinality t(c,n) left join bands using(n)
  ), all_fields as (
    select n-5 as pos,label as id,label from unnest(array['Market','Client','Rep','Firm']) with ordinality t(label,n)
    union all select n,label || '/' || (n-1),label from labels
    union all select 2147483646,'Market review','Market review' union all select 2147483647,'Source file','Source file'
  ) select jsonb_agg(jsonb_build_object('id',id,'label',label) order by pos) into fields from all_fields;
  insert into ff_tv_catalog(batch_key,header,fields,options,total) values
    (p_batch, doc - 'rows' - 'sources', fields, '{}',jsonb_array_length(doc->'rows'));

  -- Resolve attribution once per unique set of original submissions, with
  -- the market-specific submission first, just as in the original workbook.
  with distinct_sources as (
    select distinct jsonb_build_array(r->'sourceKeys',r->'sourceMarketId') k from jsonb_array_elements(doc->'rows') r
  ) select coalesce(jsonb_object_agg(k::text,id),'{}') into source_map
    from (select k,row_number() over (order by k) as id from distinct_sources) s;
  insert into ff_tv_sources(batch_key,source,files,rep,firm)
    select p_batch,id::integer, f.files,
      coalesce((select string_agg(rep,', ' order by first) from (
        select file->>'rep' rep,min(n) first from jsonb_array_elements(f.files) with ordinality t(file,n) group by 1) names),''),
      coalesce((select string_agg(firm,', ' order by first) from (
        select file->>'firm' firm,min(n) first from jsonb_array_elements(f.files) with ordinality t(file,n) group by 1) names),'')
    from jsonb_each_text(source_map) s(key,id) cross join lateral (
      select coalesce(jsonb_agg(file order by coalesce((s.key::jsonb->>1)<>'' and file->>'marketId'=(s.key::jsonb->>1),false) desc,ki,fi),'[]') files
      from jsonb_array_elements_text(s.key::jsonb->0) with ordinality k(hash,ki)
      cross join lateral jsonb_array_elements(source_docs->hash->'files') with ordinality t(file,fi)
    ) f;
  insert into ff_tv_rows(batch_key,ordinal,body,source,market,client,issue_key)
    select p_batch,n-1,r,(source_map->>jsonb_build_array(r->'sourceKeys',r->'sourceMarketId')::text)::int,
      r->>'market',r->>'client',r#>>'{issue,key}' from jsonb_array_elements(doc->'rows') with ordinality t(r,n);
  with options as (
    select 'market' kind,market label from ff_tv_rows where batch_key=p_batch
    union select 'client',client from ff_tv_rows where batch_key=p_batch
    union select 'rep',f->>'rep' from ff_tv_sources s cross join jsonb_array_elements(s.files) f where s.batch_key=p_batch
    union select 'firm',f->>'firm' from ff_tv_sources s cross join jsonb_array_elements(s.files) f where s.batch_key=p_batch
  ), grouped as (
    select kind,jsonb_agg(label order by label collate "en-US-x-icu") labels from options where label<>'' group by kind
  ) update ff_tv_catalog set options='{"market":[],"client":[],"rep":[],"firm":[]}'::jsonb ||
       coalesce((select jsonb_object_agg(kind,labels) from grouped),'{}') where batch_key=p_batch;
end $$;

create function public.ff_sync_tv_index() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.ff_index_tv(new.batch_key,new.content);
  return null;
end $$;
create trigger ff_sync_tv_index after insert or update of content on public.ff_broadcast_research_sheets
for each row when (new.sheet='tv') execute function public.ff_sync_tv_index();
select public.ff_index_tv(batch_key,content) from public.ff_broadcast_research_sheets where sheet='tv' and content ? 'columns' and content ? 'rows';

-- Match the workbook's numeric-aware grouping and en-US cell formatting.
create collation public.ff_workbook_numeric (provider=icu,locale='en-u-kn-true');
create function public.ff_tv_cell_label(cell jsonb) returns text language sql immutable parallel safe set search_path = '' as $$
  select case when cell is null or cell='null' then ''
    when jsonb_typeof(cell)<>'object' then cell#>>'{}'
    when cell->>'value' is null then 'Unavailable'
    else (case when v<0 then '-' else '' end) || (case when unit='USD' then '$' else '' end) ||
      case when unit='USD' then fmt else regexp_replace(regexp_replace(fmt,'0+$',''),'\.$','') end ||
      case when unit='percent' then '%' else '' end
    end from (select (case when jsonb_typeof(cell)='object' then (cell->>'value')::numeric end) v,cell->>'unit' unit) raw
    cross join lateral (select to_char(abs(v),'FM999,999,999,999,999,999,999,990.00') fmt) formatted
$$;

create function public.ff_tv_group_label(field text,r public.ff_tv_rows,s public.ff_tv_sources,reviews jsonb)
returns text language sql stable parallel safe set search_path = '' as $$
  select case field when 'Market' then coalesce(reviews->r.issue_key->>'market_name',r.market)
    when 'Client' then r.client when 'Rep' then s.rep when 'Firm' then s.firm
    when 'Source file' then coalesce(s.files->0->>'name','')
    when 'Market review' then case when reviews ? r.issue_key then 'Reviewed' else coalesce(r.body#>>'{issue,sourceMarket}','') end
    else case when field is not null then public.ff_tv_cell_label(r.body->'cells'->(substring(field from '/([0-9]+)$'))::int) end
  end
$$;

create function public.ff_tv_workbook_page(p_batch text,p_market text,p_client text,p_rep text,p_firm text,
  p_primary text,p_secondary text,p_page integer) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $$
declare
  catalog ff_tv_catalog%rowtype; g1 text; g2 text; allowed integer[]; reviews jsonb; options jsonb;
  matches integer; pages integer; page integer; start_at integer; lines jsonb;
begin
  select * into catalog from ff_tv_catalog where batch_key=p_batch;
  if not found then return null; end if;
  select coalesce(jsonb_object_agg(review_key,jsonb_build_object('review_key',review_key,'market_id',market_id,'market_name',market_name)),'{}')
    into reviews from ff_broadcast_research_market_reviews where batch_key=p_batch;
  options := catalog.options;
  if reviews<>'{}' then
    options := jsonb_set(options,'{market}',(select coalesce(jsonb_agg(m order by m collate "en-US-x-icu"),'[]') from (
      select distinct coalesce(reviews->r.issue_key->>'market_name',r.market) m from ff_tv_rows r where r.batch_key=p_batch
    ) markets where m<>''));
  end if;
  select f->>'id' into g1 from jsonb_array_elements(catalog.fields) f where f->>'id'=p_primary;
  if g1 is not null and p_secondary<>g1 then
    select f->>'id' into g2 from jsonb_array_elements(catalog.fields) f where f->>'id'=p_secondary;
  end if;
  if p_rep<>'' or p_firm<>'' then
    select array(select s.source from ff_tv_sources s where s.batch_key=p_batch and
      exists (select from jsonb_array_elements(s.files) f where (p_rep='' or f->>'rep'=p_rep) and (p_firm='' or f->>'firm'=p_firm))) into allowed;
  end if;
  if p_market='' and p_client='' and allowed is null then matches := catalog.total;
  else select count(*) into matches from ff_tv_rows r where r.batch_key=p_batch and
    (p_market='' or coalesce(reviews->r.issue_key->>'market_name',r.market)=p_market) and (p_client='' or r.client=p_client)
    and (allowed is null or r.source=any(allowed));
  end if;
  pages := greatest(1,(matches+99)/100);
  page := greatest(1,least(p_page,pages));
  start_at := (page-1)*100;
  if g1 is null and reviews='{}' and p_market='' and p_client='' and allowed is null then
    -- Dense ordinals let an ordinary tab switch or deep page seek directly.
    select coalesce(jsonb_agg(jsonb_build_array(jsonb_build_object('row',r.body,'market',r.market,'files',s.files,'rep',s.rep,'firm',s.firm))
      order by r.ordinal),'[]') into lines
      from ff_tv_rows r join ff_tv_sources s using(batch_key,source)
      where r.batch_key=p_batch and r.ordinal>=start_at and r.ordinal<start_at+100;
  else
    with selected as materialized (
      select r.ordinal,coalesce(reviews->r.issue_key->>'market_name',r.market) market,
        ff_tv_group_label(g1,r,s,reviews) collate ff_workbook_numeric k1,
        ff_tv_group_label(g2,r,s,reviews) collate ff_workbook_numeric k2,
        case when reviews<>'{}' then coalesce(reviews->r.issue_key->>'market_name',r.market) end collate "en-US-x-icu" base_market
      from ff_tv_rows r join ff_tv_sources s using(batch_key,source) where r.batch_key=p_batch
        and (p_market='' or coalesce(reviews->r.issue_key->>'market_name',r.market)=p_market) and (p_client='' or r.client=p_client)
        and (allowed is null or r.source=any(allowed))
      order by k1,k2,base_market,r.ordinal limit 100 offset start_at
    )
    select coalesce(jsonb_agg(jsonb_build_array(jsonb_build_object('row',r.body,'market',p.market,'files',s.files,'rep',s.rep,'firm',s.firm))
      order by p.k1,p.k2,p.base_market,p.ordinal),'[]') into lines from selected p
      join ff_tv_rows r on r.batch_key=p_batch and r.ordinal=p.ordinal join ff_tv_sources s using(batch_key,source);
  end if;
  return jsonb_build_object('sheet',catalog.header,'groupFields',catalog.fields,'filterOptions',options,
    'grouping',jsonb_build_object('primary',coalesce(g1,''),'secondary',coalesce(g2,'')),
    'total',catalog.total,'matches',matches,'pages',pages,'page',page,'offset',start_at,'matrix',false,'periods','[]'::jsonb,
    'hasRates',false,'lines',lines,'reviews',(select coalesce(jsonb_agg(value),'[]') from jsonb_each(reviews)));
end $$;

revoke all on function public.ff_sync_tv_index(), public.ff_index_tv(text,jsonb), public.ff_tv_cell_label(jsonb),
  public.ff_tv_group_label(text,public.ff_tv_rows,public.ff_tv_sources,jsonb),
  public.ff_tv_workbook_page(text,text,text,text,text,text,text,integer),
  public.ff_radio_workbook_page(text,text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ff_index_tv(text,jsonb) to service_role;
grant execute on function public.ff_tv_cell_label(jsonb),public.ff_tv_group_label(text,public.ff_tv_rows,public.ff_tv_sources,jsonb),
  public.ff_tv_workbook_page(text,text,text,text,text,text,text,integer),
  public.ff_radio_workbook_page(text,text,text,text,text,text,text,integer) to authenticated,service_role;
