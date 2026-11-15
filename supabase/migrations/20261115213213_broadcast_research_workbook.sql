begin;

create table public.ff_broadcast_research_sheets (
  batch_key text not null,
  sheet text not null check (sheet in ('tv', 'radio', 'demographics', 'notes', 'reference')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  imported_at timestamptz not null default now(),
  primary key (batch_key, sheet)
);

create table public.ff_broadcast_research_market_reviews (
  batch_key text not null,
  review_key text not null,
  market_id text not null,
  market_name text not null check (length(market_name) between 1 and 120),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  primary key (batch_key, review_key)
);

alter table public.ff_broadcast_research_sheets enable row level security;
alter table public.ff_broadcast_research_market_reviews enable row level security;

revoke all on public.ff_broadcast_research_sheets, public.ff_broadcast_research_market_reviews from public, anon, authenticated;
grant select on public.ff_broadcast_research_sheets, public.ff_broadcast_research_market_reviews to authenticated;
grant select, insert, update on public.ff_broadcast_research_sheets, public.ff_broadcast_research_market_reviews to service_role;

create policy broadcast_research_sheets_read on public.ff_broadcast_research_sheets
  for select to authenticated
  using (exists (select from public.ff_members where user_id = (select auth.uid())));
create policy broadcast_research_market_reviews_read on public.ff_broadcast_research_market_reviews
  for select to authenticated
  using (exists (select from public.ff_members where user_id = (select auth.uid())));

commit;
