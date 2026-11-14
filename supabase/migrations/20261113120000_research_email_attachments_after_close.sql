-- REVIEW ARTIFACT ONLY. Not applied. Requires explicit database approval.
-- Closing a collection stops the rep's upload link. It must not withhold files the rep
-- later sends by email: those are scanned on arrival and are staff-only records.
-- Portal files are unchanged: they still require an upload lease.
begin;
create or replace function public.ff_research_verify_file(p_file uuid,p_state text,p_error text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare f ff_research_files;
begin
  if p_state is null or p_state not in ('ready','held','failed') then raise exception 'Invalid verification state.'; end if;
  select * into f from ff_research_files where id=p_file;
  if f.source='portal' then raise exception using errcode='42501',message='Portal verification requires an upload lease.'; end if;
  update ff_research_files set state=p_state,error=left(p_error,1000),updated_at=now() where id=p_file and state='checking';
  update ff_research_conversations set updated_at=now() where id=f.conversation_id;
end $$;
-- CREATE OR REPLACE preserves the existing service-only permissions.
notify pgrst,'reload schema';
commit;
