begin;

create table public.ff_order_oauth_clients (
  client_id uuid primary key,
  resource text not null check (resource in ('https://my.finalforemedia.com/mcp','http://127.0.0.1:3107/mcp'))
);
alter table public.ff_order_oauth_clients enable row level security;
revoke all on public.ff_order_oauth_clients from public,anon,authenticated,service_role;
grant select on public.ff_order_oauth_clients to supabase_auth_admin;
create policy ff_order_oauth_hook_read on public.ff_order_oauth_clients for select to supabase_auth_admin using (true);

create function public.ff_market_order_access_token(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  claims jsonb := event->'claims';
  audience text;
begin
  if nullif(claims->>'client_id','') is null then
    return event;
  end if;
  select resource into audience from public.ff_order_oauth_clients where client_id::text=claims->>'client_id';
  if audience is null then
    return event;
  end if;
  -- This JWT is for the market MCP endpoint. The role has no database grants.
  claims := claims || jsonb_build_object('aud',audience,'role','ff_market_order_oauth');
  return jsonb_set(event,'{claims}',claims);
end $$;

revoke all on function public.ff_market_order_access_token(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ff_market_order_access_token(jsonb) to supabase_auth_admin;

commit;
