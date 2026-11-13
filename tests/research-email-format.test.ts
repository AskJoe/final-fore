import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTemplates} from '../lib/research/templates';
import {renderEmail} from '../lib/research/render';
import {inspectTemplate} from '../lib/research/template-inspection';
import type {Recipient} from '../lib/research/types';
import formatSource from '../data/research-template-formatting.json';
const recipient:Recipient={repId:'rep-test',firmId:'firm-test',templateId:'tv-multi',name:'John Wahlert',firmName:'Katz TV',to:'john@example.test',cc:[]};
const values={deadline:'2026-12-01',flight_dates:'February–May 2027',radio_trender_books:'February–September 2026',ranker_books:'March, July and September 2026',tv_books:'March, July and September 2026',avail_book:'March 2026'};
test('all source templates retain six numbered sections, circle sub-bullets and source emphasis',()=>{
  for(const t of sourceTemplates()){
    const email=renderEmail(t,recipient,values,'https://example.test/upload');
    assert.equal((email.html.match(/<ol /g)??[]).length,1,t.id);
    const radio=t.media==='broadcast-radio';
    assert.equal((email.html.match(/<ul /g)??[]).length,radio?4:3,t.id);
    assert.equal((email.html.match(/<li /g)??[]).length,radio?20:15,t.id);
    const headings=radio?['Station Trenders','Top 20 Market Ranker',':30 Rates','Station Coverage Maps','Qualitative Data','Market or Station Changes']:['Trender Report','Avail News only','Station Coverage Maps','Qualitative Data','Market or Station Changes','Sqad Goals'];
    headings.forEach((heading,i)=>assert.match(email.text,new RegExp('(?:^|\\n)'+(i+1)+'\\. '+heading),t.id));
    assert.match(email.html,/list-style-type:circle/);
    assert.match(email.html,/<em>If you only subscribe to Nielsen/);
    assert.match(email.html,/<strong>Station Coverage Maps<\/strong>/);
    for(const color of ['#cb10be','#db268a','#d8a62a'])assert.ok(email.html.includes(color),t.id+' '+color);
    assert.match(email.html,/<u><strong>IF YOUR STATION&#39;S CPMS COME IN HIGH COMPARED TO THE OTHER STATIONS IN THE MARKET OR YOUR CPMS ARE HIGHER THAN WHAT WE PAID LAST YEAR, THEN ODDS ARE YOUR STATION WILL BE PASSED OVER\.?<\/strong><\/u>/);
    const ratingsFallback='If you don’t subscribe to ratings, please send any recent research you have that closely meets our criteria.';
    assert.equal(email.text.includes(ratingsFallback),t.scope==='single',t.id);
    assert.equal(email.html.includes(ratingsFallback),t.scope==='single',t.id);
    assert.equal((email.html.match(/href="https:\/\/example\.test\/upload"/g)??[]).length,1,t.id);
    assert.doesNotMatch(email.html,/background[^;]*red|google drive|PURPOSE:|SOP -/i);
    assert.doesNotMatch(email.html,/\{\{/);
    assert.equal(email.missing.length,0);
    for(const market of t.markets)assert.ok(email.text.includes(market.displayName));
  }
});
test('format metadata is a complete content-preserving transcription of each template',()=>{
  for(const t of sourceTemplates()){
    const source=formatSource.templates[t.id as keyof typeof formatSource.templates];
    assert.equal(source.paragraphs.map(p=>p.text).join('\n\n'),t.body);
    for(const p of source.paragraphs)assert.equal(p.runs.map(r=>r.text).join(''),p.text);
  }
});
test('missing values remain marked inside formatted HTML, and merge text cannot inject HTML',()=>{
  const t=sourceTemplates()[0];
  const inspected=inspectTemplate(t,recipient,'','https://app.example.test/research-upload/preview');assert.match(inspected.html,/<ol /);assert.match(inspected.html,/<mark class="research-missing-value">Flight dates needed<\/mark>/);
  const email=renderEmail(t,recipient,{...values,radio_trender_books:'<img src=x onerror=alert(1)>'},'https://example.test/upload');
  assert.match(email.html,/&lt;img/);assert.doesNotMatch(email.html,/<img/);
});
test('changed paragraph content is retained and format affects the reviewed render hash',()=>{
  const t=sourceTemplates()[0],original=renderEmail(t,recipient,values,'https://example.test/upload');
  const edited=renderEmail({...t,body:t.body.replace('Station Coverage Maps','Updated coverage request')},recipient,values,'https://example.test/upload');
  assert.match(edited.html,/Updated coverage request/);assert.doesNotMatch(edited.html,/Station Coverage Maps/);assert.notEqual(original.renderHash,edited.renderHash);
});
