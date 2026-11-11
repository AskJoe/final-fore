import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTemplates } from '../lib/research/templates';
import { renderEmail, parsePreviewInput } from '../lib/research/render';
import type { Recipient } from '../lib/research/types';

const recipient:Recipient={repId:'rep-test',firmId:'firm-test',templateId:'tv-multi',name:'John Wahlert',firmName:'Katz TV',to:'john@example.test',cc:[]};
const values={deadline:'2026-12-01',flight_dates:'March–October 2027',radio_trender_books:'Spring 2025–Fall 2026',ranker_books:'Fall 2026',tv_books:'July 2026',avail_book:'July 2026'};
test('preview includes the complete template-owned market list and content',()=>{
  for(const t of sourceTemplates()) {
    const r=renderEmail(t,recipient,values,'https://research.example.test/upload/opaque');
    for(const market of t.markets) assert.ok(r.text.includes(market.displayName),market.displayName);
    assert.match(r.text,/Station Coverage Maps/);assert.match(r.text,/Market or Station Changes/);
    assert.match(r.text,/https:\/\/research.example.test\/upload\/opaque/);
    assert.equal(r.missing.length,0,JSON.stringify(r.missing));
    assert.doesNotMatch(r.text,/\{\{/);
  }
});
test('preview rejects request-level markets and malformed input rather than ignoring overrides',()=>{
  const input={templateId:'tv-multi',repId:'rep-test',deadline:'2026-12-01'};
  assert.deepEqual(parsePreviewInput(input),input);
  for(const key of ['markets','marketIds','body','subject','clientId']) assert.throws(()=>parsePreviewInput({...input,[key]:[]}),/Unknown|template/i);
  assert.throws(()=>parsePreviewInput({...input,deadline:'2026-02-30'}),/date/i);
  assert.throws(()=>parsePreviewInput({...input,repId:42}),/rep/i);
});
test('missing campaign fields remain visible, and render hashes change with the reviewed content',()=>{
  const t=sourceTemplates()[0],a=renderEmail(t,recipient,{deadline:'2026-12-01'},'https://example.test/upload');
  assert.ok(a.missing.includes('flight_dates'));assert.match(a.text,/\{\{flight_dates\}\}/);
  const b=renderEmail({...t,markets:t.markets.slice(0,2)},recipient,values,'https://example.test/upload');
  assert.notEqual(a.renderHash,b.renderHash);
  const c=renderEmail(t,recipient,values,'https://example.test/upload');
  assert.notEqual(c.renderHash,renderEmail(t,{...recipient,to:'changed@example.test'},values,'https://example.test/upload').renderHash);
});
test('merge content is escaped, subject header injection rejected, upload links restricted',()=>{
  const t=sourceTemplates()[0],r=renderEmail(t,{...recipient,name:'<img src=x onerror=alert(1)>'},values,'https://example.test/upload');
  assert.ok(r.html.includes('&lt;img'));assert.doesNotMatch(r.html,/<img/);
  assert.throws(()=>renderEmail({...t,subject:'Hello\r\nBcc: bad@example.test'},recipient,values,'https://example.test/upload'),/subject/i);
  assert.throws(()=>renderEmail(t,recipient,values,'javascript:alert(1)'),/upload/i);
});
