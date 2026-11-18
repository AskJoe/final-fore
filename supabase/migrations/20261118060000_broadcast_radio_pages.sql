-- Radio snapshots stay immutable so a page and its source files agree during publication.
create table public.ff_radio_versions (
  version text primary key check (version ~ '^[0-9a-f]{64}$'),
  total integer not null check (total >= 0),
  header jsonb not null,
  options jsonb not null,
  fields jsonb not null
);
create table public.ff_radio_attributions (
  version text not null references public.ff_radio_versions,
  attribution integer not null,
  files jsonb not null,
  rep text not null,
  firm text not null,
  primary key (version, attribution)
);
create table public.ff_radio_rows (
  version text not null,
  ordinal integer not null check (ordinal >= 0),
  market text not null, client text not null, attribution integer not null,
  ranks integer[] not null, series integer not null, occurrence integer not null,
  period text not null, rated boolean not null, body jsonb not null,
  primary key (version, ordinal),
  foreign key (version, attribution) references public.ff_radio_attributions
);
create index ff_radio_market_page on public.ff_radio_rows(version, market, ordinal);
create index ff_radio_attribution_page on public.ff_radio_rows(version, attribution, ordinal);
alter table public.ff_broadcast_research_sheets add column radio_version text;
-- A future sheet replacement cannot accidentally serve the previous index.
create function public.ff_set_radio_version() returns trigger language plpgsql
set search_path = '' as $$
begin
  new.radio_version := case when new.sheet='radio' and new.content ? 'columns' and new.content ? 'rows'
    then encode(sha256(jsonb_send(new.content)), 'hex') end;
  if tg_op='UPDATE' and old.radio_version is not null and new.radio_version is distinct from old.radio_version then
    if not exists (
      select from public.ff_radio_versions v where v.version=new.radio_version
        and v.total=jsonb_array_length(new.content->'rows')
        and v.total=(select count(*) from public.ff_radio_rows r where r.version=v.version)
    ) then raise exception 'Prepare the complete radio index before replacing this workbook'; end if;
  end if;
  return new;
end $$;
create trigger ff_set_radio_version before insert or update of content on public.ff_broadcast_research_sheets
for each row when (new.sheet='radio') execute function public.ff_set_radio_version();

alter table public.ff_radio_versions enable row level security;
alter table public.ff_radio_attributions enable row level security;
alter table public.ff_radio_rows enable row level security;
create policy ff_radio_versions_read on public.ff_radio_versions for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
create policy ff_radio_attributions_read on public.ff_radio_attributions for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
create policy ff_radio_rows_read on public.ff_radio_rows for select to authenticated
  using (exists (select from public.ff_members where user_id=(select auth.uid())));
revoke all on public.ff_radio_versions, public.ff_radio_attributions, public.ff_radio_rows from public, anon, authenticated;
grant select on public.ff_radio_versions, public.ff_radio_attributions, public.ff_radio_rows to authenticated;
grant select, insert on public.ff_radio_versions, public.ff_radio_attributions, public.ff_radio_rows to service_role;

create function public.ff_radio_page(p_batch text, p_market text, p_client text, p_rep text, p_firm text,
  p_primary text, p_secondary text, p_page integer) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp set plan_cache_mode = force_custom_plan as $$
declare
  catalog ff_radio_versions%rowtype;
  active_version text;
  allowed integer[];
  g1 integer; g2 integer; label1 text; label2 text;
  monthly boolean;
  matches integer; lines integer; page_size integer := 100;
  pages integer; page integer; start_at integer;
  periods text[] := '{}'; rates boolean := false;
  page_lines jsonb;
begin
  select radio_version into active_version from ff_broadcast_research_sheets where batch_key=p_batch and sheet='radio';
  if not found then return null; end if;
  select * into strict catalog from ff_radio_versions where version=active_version;
  select n, f->>'label' into g1,label1 from jsonb_array_elements(catalog.fields) with ordinality as t(f,n) where f->>'id'=p_primary;
  if g1 is not null and p_primary<>p_secondary then
    select n, f->>'label' into g2,label2 from jsonb_array_elements(catalog.fields) with ordinality as t(f,n) where f->>'id'=p_secondary;
  end if;
  monthly := coalesce((label1='Market' and label2='Daypart') or (label2='Market' and label1='Daypart'), false);
  if p_rep<>'' or p_firm<>'' then
    select array(select a.attribution from ff_radio_attributions a where a.version=active_version and
      exists (select from jsonb_array_elements(a.files) f where (p_rep='' or f->>'rep'=p_rep) and (p_firm='' or f->>'firm'=p_firm))) into allowed;
  end if;
  if monthly then
    select count(*), count(distinct (r.series,r.occurrence)), coalesce(array_agg(distinct r.period order by r.period),'{}'), coalesce(bool_or(r.rated),false)
      into matches,lines,periods,rates from ff_radio_rows r where r.version=active_version
      and (p_market='' or r.market=p_market) and (p_client='' or r.client=p_client) and (allowed is null or r.attribution=any(allowed));
    page_size := greatest(5,least(100,2000 / (10 + cardinality(periods) * case when rates then 5 else 3 end)));
  else
    if p_market='' and p_client='' and allowed is null then matches := catalog.total;
    else
      select count(*) into matches from ff_radio_rows r where r.version=active_version
        and (p_market='' or r.market=p_market) and (p_client='' or r.client=p_client) and (allowed is null or r.attribution=any(allowed));
    end if;
    lines := matches;
  end if;
  pages := greatest(1, (lines + page_size - 1) / page_size);
  page := greatest(1, least(pages, p_page));
  start_at := (page - 1) * page_size;
  if monthly then
    select jsonb_agg(ids order by k1,k2,series,occurrence) into page_lines from (
      select r.ranks[g1] k1,r.ranks[g2] k2,r.series,r.occurrence,array_agg(r.ordinal order by r.ordinal) ids
      from ff_radio_rows r where r.version=active_version and (p_market='' or r.market=p_market)
        and (p_client='' or r.client=p_client) and (allowed is null or r.attribution=any(allowed))
      group by 1,2,r.series,r.occurrence order by 1,2,r.series,r.occurrence limit page_size offset start_at
    ) selected;
  elsif g1 is null and p_market='' and p_client='' and allowed is null then
    -- Ordinals are dense. Deep pages can seek straight to the first observation.
    select jsonb_agg(array[ordinal] order by ordinal) into page_lines from (
      select ordinal from ff_radio_rows where version=active_version and ordinal>=start_at order by ordinal limit page_size
    ) selected;
  else
    select jsonb_agg(array[ordinal] order by k1,k2,ordinal) into page_lines from (
      select r.ordinal,case when g1 is not null then r.ranks[g1] end k1,case when g2 is not null then r.ranks[g2] end k2
      from ff_radio_rows r where r.version=active_version and (p_market='' or r.market=p_market)
        and (p_client='' or r.client=p_client) and (allowed is null or r.attribution=any(allowed))
      order by k1,k2,r.ordinal limit page_size offset start_at
    ) selected;
  end if;
  return jsonb_build_object('version',catalog.version,'sheet',catalog.header,'filterOptions',catalog.options,'groupFields',catalog.fields,
    'total',catalog.total,'matches',matches,'pages',pages,'page',page,'offset',start_at,'matrix',monthly,'hasRates',rates,'periods',periods,
    'grouping',jsonb_build_object('primary',case when g1 is null then '' else p_primary end,'secondary',case when g2 is null then '' else p_secondary end),
    'lines',coalesce(page_lines,'[]'));
end $$;

create function public.ff_radio_entries(p_version text, p_ordinals integer[]) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if cardinality(p_ordinals)>100 then raise exception 'A radio request can read at most 100 observations'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('row',r.body,'market',r.market,'files',a.files,'rep',a.rep,'firm',a.firm)
    order by ids.position),'[]') from unnest(p_ordinals) with ordinality ids(ordinal,position)
    join ff_radio_rows r on r.version=p_version and r.ordinal=ids.ordinal
    join ff_radio_attributions a on a.version=r.version and a.attribution=r.attribution);
end $$;
revoke all on function public.ff_set_radio_version(), public.ff_radio_page(text,text,text,text,text,text,text,integer),
  public.ff_radio_entries(text,integer[]) from public, anon, authenticated;
grant execute on function public.ff_radio_page(text,text,text,text,text,text,text,integer), public.ff_radio_entries(text,integer[])
  to authenticated, service_role;
