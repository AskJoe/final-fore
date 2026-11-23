-- Run in an isolated PostgreSQL fixture after applying the Orders migration.
begin;
insert into public.ff_members(user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

do $$
begin
  assert not has_function_privilege('authenticated','public.ff_orders_command(uuid,text,jsonb)','EXECUTE');
  assert not has_function_privilege('anon','public.ff_orders_detail(uuid)','EXECUTE');
  assert not has_table_privilege('authenticated','public.ff_order_drafts','SELECT');
  assert not has_table_privilege('service_role','public.ff_order_issues','UPDATE');
  assert not has_table_privilege('service_role','public.ff_order_events','UPDATE');
  assert not has_table_privilege('service_role','public.ff_order_events','DELETE');
  assert (select not public from storage.buckets where id='ff-order-pdfs');
end;
$$;

set local role service_role;
do $$
declare
  actor uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  cal uuid;
  deadline uuid;
  copy_deadline uuid;
  draft uuid;
  issue uuid;
  second_draft uuid;
  second_issue uuid;
  send_event uuid;
  old_event uuid;
  state jsonb;
  send_action jsonb;
  saved_action jsonb;
  paper jsonb := '{"number":"TEST-2027","lines":[{"id":"placement","marketId":"epic3-arkansas-nwa","media":"Digital"}]}';
begin
  begin
    perform public.ff_orders_command('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','saveCalendar',
      '{"clientId":"epic3","year":2027,"name":"Unauthorized","expectedRevision":0,"operationId":"unauthorized"}');
    raise exception 'Unknown actor should not have access.';
  exception when insufficient_privilege then null;
  end;
  state := public.ff_orders_command(actor,'saveCalendar',
    '{"clientId":"epic3","year":2027,"name":"Test deadlines","expectedRevision":0,"operationId":"calendar"}');
  cal := (state->>'id')::uuid;
  state := public.ff_orders_command(actor,'saveDeadline',
    jsonb_build_object('calendarId',cal,'marketId','epic3-arkansas-nwa','step','digital',
      'dueDate','2027-02-10','expectedRevision',0,'operationId','deadline'));
  deadline := (state->>'id')::uuid;
  assert state->>'status' = 'Not started';
  saved_action := jsonb_build_object('clientId','epic3','year',2027,'marketIds',jsonb_build_array('epic3-arkansas-nwa'),
    'workflow','digital','expectedRevision',0,'operationId','first-save','originKey','arkansas-digital',
    'document',paper,'deadlineId',deadline,'deadlineRevision',1);
  state := public.ff_orders_command(actor,'saveOrder',saved_action);
  draft := (state->>'id')::uuid;
  old_event := (state#>>'{history,0,id}')::uuid;
  assert state->>'revision' = '1';
  assert state->>'originKey' = 'arkansas-digital';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'In progress';
  assert public.ff_orders_command(actor,'saveOrder',saved_action)->>'id' = draft::text;
  assert jsonb_array_length(public.ff_orders_detail(draft)->'history') = 1;
  begin
    perform public.ff_orders_command(actor,'saveOrder', saved_action || '{"operationId":"invalid","year":2028,"deadlineRevision":2}');
    raise exception 'Cross-year link should fail.';
  exception when sqlstate 'PT400' then null;
  end;
  assert jsonb_array_length(public.ff_orders_workspace('epic3',2028)->'orders') = 0;
  assert jsonb_array_length(public.ff_orders_workspace('other-client',2027)->'orders') = 0;
  state := public.ff_orders_command(actor,'finalizeOrder',jsonb_build_object(
    'id',draft,'expectedRevision',1,'operationId','issue','artifact',jsonb_build_object(
      'storageKey',draft::text || '/1.pdf','sha256',repeat('1',64),'bytes',1024,'templateVersion','test-v1'
    )));
  issue := (state#>>'{currentIssue,id}')::uuid;
  assert state#>>'{currentIssue,number}' = 'TEST-2027';
  assert state->>'downloaded' = 'false';
  assert state->>'sent' = 'false';
  begin
    perform public.ff_orders_command(actor,'saveOrder',jsonb_build_object(
      'id',draft,'expectedRevision',1,'operationId','edit-final','document',paper));
    raise exception 'Finalized revision should reject edits.';
  exception when sqlstate 'PT409' then null;
  end;
  state := public.ff_orders_command(actor,'recordDownload',jsonb_build_object('id',draft,'issueId',issue,'operationId','download'));
  assert state->>'downloaded' = 'true';
  assert state->>'sent' = 'false';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'In progress';
  state := public.ff_orders_command(actor,'recordDownload',jsonb_build_object('id',draft,'issueId',issue,'operationId','download'));
  assert jsonb_array_length(state->'history') = 3;
  send_action := jsonb_build_object('id',draft,'issueId',issue,'recipient','recipient@example.test',
    'sentAt','2020-02-01T12:00:00Z','operationId','send');
  state := public.ff_orders_command(actor,'recordSend',send_action);
  select (event->>'id')::uuid into send_event from jsonb_array_elements(state->'history') as event where event->>'type'='sent';
  assert state->>'sent' = 'true';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'Complete';
  state := public.ff_orders_command(actor,'saveDeadline',jsonb_build_object('id',deadline,'calendarId',cal,
    'marketId','epic3-arkansas-nwa','step','digital','dueDate','2027-02-10','expectedRevision',2,
    'statusOverride','Needs decision','operationId','manual-status'));
  assert state->>'status' = 'Needs decision';
  state := public.ff_orders_command(actor,'saveOrder',
    (saved_action - 'deadlineId' - 'deadlineRevision') || '{"operationId":"second-save","originKey":"second-arkansas-digital"}');
  second_draft := (state->>'id')::uuid;
  state := public.ff_orders_command(actor,'saveDeadline',jsonb_build_object('id',deadline,'calendarId',cal,
    'marketId','epic3-arkansas-nwa','step','digital','dueDate','2027-02-10','expectedRevision',3,
    'orderIds',jsonb_build_array(draft,second_draft),'statusOverride',null,'operationId','automatic-status'));
  assert jsonb_array_length(state->'orderIds') = 2;
  assert state->>'status' = 'In progress';
  state := public.ff_orders_command(actor,'finalizeOrder',jsonb_build_object(
    'id',second_draft,'expectedRevision',1,'operationId','second-issue','artifact',jsonb_build_object(
      'storageKey',second_draft::text || '/1.pdf','sha256',repeat('2',64),'bytes',1024,'templateVersion','test-v1'
    )));
  second_issue := (state#>>'{currentIssue,id}')::uuid;
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'In progress';
  state := public.ff_orders_command(actor,'recordSend',send_action || jsonb_build_object(
    'id',second_draft,'issueId',second_issue,'operationId','second-send'));
  assert state->>'sent' = 'true';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'Complete';
  state := public.ff_orders_command(actor,'correctSend',jsonb_build_object('id',draft,'issueId',issue,
    'sendEventId',send_event,'note','Wrong receipt','operationId','correction'));
  assert state->>'sent' = 'false';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'In progress';
  state := public.ff_orders_command(actor,'recordSend',send_action || '{"operationId":"send-again"}');
  assert state->>'sent' = 'true';
  state := public.ff_orders_command(actor,'createRevision',jsonb_build_object('id',draft,'expectedRevision',1,'operationId','revise'));
  assert state->>'revision' = '2';
  assert state->'currentIssue' = 'null'::jsonb;
  assert state#>>'{issues,0,sent}' = 'true';
  assert public.ff_order_deadline_detail(deadline)->>'status' = 'In progress';
  state := public.ff_orders_command(actor,'saveOrder',jsonb_build_object('id',draft,'expectedRevision',2,
    'operationId','edit','document',paper || '{"number":"TEST-2027-REV"}'));
  assert state->>'number' = 'TEST-2027-REV';
  assert state#>>'{issues,0,number}' = 'TEST-2027';
  state := public.ff_orders_command(actor,'restoreRevision',jsonb_build_object('id',draft,'expectedRevision',3,
    'eventId',old_event,'operationId','restore'));
  assert state->>'revision' = '4';
  assert state->>'number' = 'TEST-2027';
  state := public.ff_orders_command(actor,'saveDeadline',
    jsonb_build_object('calendarId',cal,'marketId','epic3-arkansas-nwa','step','copy',
      'dueDate','2027-02-10','expectedRevision',0,'operationId','copy'));
  copy_deadline := (state->>'id')::uuid;
  state := public.ff_orders_command(actor,'recordCopySend',jsonb_build_object('id',copy_deadline,'expectedRevision',1,
    'sentAt','2020-02-01T13:00:00Z','operationId','copy-sent'));
  assert state->>'status' = 'Complete';
  state := public.ff_orders_command(actor,'recordCopySend',jsonb_build_object('id',copy_deadline,'expectedRevision',2,
    'sentAt',null,'operationId','copy-corrected'));
  assert state->>'status' = 'Not started';
  state := public.ff_orders_command(actor,'saveMarketDeadlines',
    jsonb_build_object('calendarId',cal,'marketId','epic3-arkansas-nwa',
      'dueDate','2027-03-01','operationId','market-kickoff'));
  assert jsonb_array_length(state->'deadlines') = 4;
  assert (select count(*)=2 from jsonb_array_elements(state->'deadlines') where value->>'dueDate'='2027-03-01');
  assert (select value->>'dueDate'='2027-02-10' and jsonb_array_length(value->'orderIds')=2
    from jsonb_array_elements(state->'deadlines') where value->>'id'=deadline::text);
  state := public.ff_orders_command(actor,'saveMarketDeadlines',
    jsonb_build_object('calendarId',cal,'marketId','epic3-arkansas-nwa',
      'dueDate','2027-04-01','operationId','market-kickoff-again'));
  assert (select count(*)=0 from jsonb_array_elements(state->'deadlines') where value->>'dueDate'='2027-04-01');
  raise notice 'Verified service-only access, atomic links, stale edit rejection, artifact versioning, idempotent downloads, all-linked sends, status override and reset, send corrections, revision restore, independent ad-copy status, and non-destructive four-step market kickoff.';
end;
$$;
rollback;
