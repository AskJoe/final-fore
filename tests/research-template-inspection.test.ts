import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTemplates } from '../lib/research/templates';
import { uploadPagePreviewUrl } from '../lib/research/upload-page-preview';
import { inspectTemplate } from '../lib/research/template-inspection';
import { parsePreviewInput, parseTemplatePreviewInput } from '../lib/research/render';
import { bulkFieldChanges } from '../lib/research/bulk-fields';
import type { Recipient } from '../lib/research/types';
const recipient:Recipient={repId:'rep-test',firmId:'firm-test',templateId:'tv-multi',name:'John Wahlert',firmName:'Katz TV',to:'john@example.test',cc:[]};
test('inspection immediately includes all market content and marks missing fields without changing templates',()=>{
  const templates=sourceTemplates(),before=structuredClone(templates);
  for(const t of templates){const url=uploadPagePreviewUrl({repId:recipient.repId,templateId:t.id,deadline:''},'https://app.example.test'),view=inspectTemplate(t,recipient,'',url);
    for(const market of t.markets)assert.ok(view.text.includes(market.displayName));
    assert.match(view.html,/Hi John/);assert.match(view.html,/Station Coverage Maps/);assert.match(view.html,/Market or Station Changes/);
    assert.match(view.html,/<mark class="research-missing-value">Due date needed<\/mark>/);
    assert.match(view.html,/href="https:\/\/app.example.test\/research-upload\/preview\?/);assert.match(view.html,/target="_blank"/);assert.ok(view.text.includes(url));assert.doesNotMatch(view.html,/Upload link created when sent|\{\{|preview.invalid/);
    assert.match(view.text,/Feb-May ’27/);assert.deepEqual(view.missing,['Due date']);
  }
  assert.deepEqual(templates,before);
});
test('inspection merges known values safely; empty date is accepted only for inspection',()=>{
  const template=sourceTemplates()[0];template.defaults.client='<script>bad</script>';
  const view=inspectTemplate(template,recipient,'2026-12-01','https://app.example.test/research-upload/preview');assert.match(view.html,/&lt;script&gt;/);assert.doesNotMatch(view.html,/<script>|Due date needed/);
  const input={repId:recipient.repId,templateId:template.id,deadline:''};assert.equal(parseTemplatePreviewInput(input).deadline,'');assert.throws(()=>parsePreviewInput(input),/date/);
  assert.throws(()=>parseTemplatePreviewInput({...input,deadline:'2026-02-30'}),/date/);
  assert.throws(()=>parseTemplatePreviewInput({...input,markets:[]}),/Unknown/);
});
test('bulk fields preserve the email text, markets and untouched values',()=>{
  const templates=sourceTemplates(),before=structuredClone(templates);
  const edits=bulkFieldChanges({templates:templates.map(t=>({id:t.id,revision:t.revision})),fields:{sender_name:'Updated sender',campaign_year:'2028'}},templates);
  assert.deepEqual(edits.map(t=>t.id).sort(),templates.map(t=>t.id).sort());
  for(const t of edits){const old=before.find(x=>x.id===t.id)!;assert.equal(t.defaults.sender_name,'Updated sender');assert.deepEqual(t.markets,old.markets);assert.equal(t.body,old.body);assert.equal(t.defaults.client,old.defaults.client);assert.equal(t.defaults.campaign_year,'2028');}
  assert.deepEqual(templates,before);
});
test('bulk validation rejects stale, duplicate, unknown and unsupported fields before changes',()=>{
  const templates=sourceTemplates(),ref={id:templates[0].id,revision:templates[0].revision};
  const valid={templates:[ref],fields:{sender_name:'Updated sender'}};
  for(const bad of [{...valid,templates:[{...ref,revision:999}]},{...valid,templates:[ref,ref]},{...valid,templates:[{id:'unknown',revision:0}]},{...valid,fields:{deadline:'2026-12-01'}},{...valid,fields:{flight_dates:'March 2027'}},{...valid,fields:{markets:[]}},{...valid,fields:{sender_name:42}},{...valid,fields:{sender_name:'x'.repeat(1001)}},{...valid,markets:[]}])assert.throws(()=>bulkFieldChanges(bad,templates));
});
