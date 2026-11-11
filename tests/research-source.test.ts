import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../lib/domain/directory';
import { MARKETS } from '../lib/domain/catalogs';
import { sourceTemplates, validateTemplate, marketChoices } from '../lib/research/templates';
import { eligibleTemplates, recipientGroups, isResearchContact } from '../lib/research/assignments';

const radio = ['Austin, TX','Bentonville/Fayetteville, AR','Boston, MA (+NH)','Cincinnati, OH','Cleveland, OH','CO Springs, CO','Dallas/Fort Worth, TX','Davenport, IA','Denver, CO','Des Moines, IA','Chicago, IL','Fort Wayne, IN','Fresno, CA','Green Bay, WI','Houston, TX','Kansas City, MO','Knoxville, TN','Lexington, KY','Madison, WI','Memphis, TN','Milwaukee, WI','Nashville, TN','Oklahoma City, OK','Omaha, NE','Rochester & Buffalo, NY','San Antonio, TX','Seattle, WA','Salt Lake City, UT','Tampa, FL'];
const tv = [...radio]; tv.splice(2,0,'Boise, ID'); tv.splice(tv.indexOf('Houston, TX')+1,0,'Iowa City/Cedar Rapids, IA'); tv.splice(tv.indexOf('Tampa, FL'),0,'Springfield (Ozarks), MO');

test('research templates own the exact source city lists, including fixed single-market variants', () => {
  const rows=sourceTemplates();
  assert.deepEqual(rows.find(t=>t.id==='radio-multi')!.markets.map(m=>m.displayName),radio);
  assert.deepEqual(rows.find(t=>t.id==='tv-multi')!.markets.map(m=>m.displayName),tv);
  assert.deepEqual(rows.find(t=>t.id==='radio-single-lincoln')!.markets.map(m=>m.displayName),['Lincoln, NE']);
  assert.deepEqual(rows.find(t=>t.id==='tv-single-madison')!.markets.map(m=>m.displayName),['Madison, WI']);
  assert.equal(marketChoices.length,35);
  rows[0].markets.pop(); assert.equal(sourceTemplates()[0].markets.length,29);
});

test('source bodies retain research instructions and replace only the Drive paragraph', () => {
  for(const t of sourceTemplates()) {
    assert.match(t.body,/\{\{upload_url\}\}/);
    assert.doesNotMatch(t.body,/google drive|folder_url/i);
    for(const phrase of ['Station Coverage Maps','Market or Station Changes','Please provide the best rates upfront!','{{sender_email}}']) assert.ok(t.body.includes(phrase),`${t.id}: ${phrase}`);
    if(t.media==='broadcast-radio') for(const phrase of ['Comscore Adults 35-64','AQH Ave Persons','DO NOT SEND AS RATINGS','HOUR BY HOUR']) assert.ok(t.body.includes(phrase),phrase);
  }
});

test('unresolved and cross-client market links remain explicit and prevent publishing', () => {
  const d=initial(), template=sourceTemplates().find(t=>t.id==='tv-multi')!;
  assert.equal(template.markets.filter(m=>!m.marketId).length,9);
  assert.equal(validateTemplate(template,d,MARKETS).filter(i=>i.code==='market-link').length,9);
  const single=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
  assert.equal(validateTemplate(single,d,MARKETS).length,0);
  single.markets[0].marketId='steve-minneapolis';
  assert.ok(validateTemplate(single,d,MARKETS).some(i=>i.code==='market-owner'));
  single.markets.push(single.markets[0]);
  assert.ok(validateTemplate(single,d,MARKETS).some(i=>i.code==='cardinality'));
});

test('source scope selects correct templates without changing their markets or inferring uncertain contacts', () => {
  const d=initial(), rows=sourceTemplates();
  const john=d.reps.find(r=>r.name==='John Wahlert')!;
  assert.deepEqual(eligibleTemplates(john,d,rows).filter(e=>e.confirmed).map(e=>e.templateId),['tv-multi']);
  const jake=d.reps.find(r=>r.name==='Jake Sorensen')!;
  assert.deepEqual(eligibleTemplates(jake,d,rows).filter(e=>e.confirmed).map(e=>e.templateId),['radio-single-lincoln']);
  for(const name of ['Lisa Matukaitis','Tracey Duvall','Mary Hess']) assert.equal(eligibleTemplates(d.reps.find(r=>r.name===name)!,d,rows).filter(e=>e.confirmed).length,0);
  assert.deepEqual(eligibleTemplates({...john,active:false},d,rows),[]);
  assert.equal(rows.find(t=>t.id==='tv-multi')!.markets.length,32);
});

test('paired primary and CC contacts create one recipient group per template', () => {
  const d=initial(), r=d.reps.find(r=>r.name==='Ryan Biederman')!, t=d.reps.find(r=>r.name==='Todd Logsdon')!;
  const groups=recipientGroups([{repId:r.id,templateId:'tv-multi'},{repId:t.id,templateId:'tv-multi'}],d,sourceTemplates());
  assert.equal(groups.length,1);
  assert.deepEqual([groups[0].to,...groups[0].cc].map(s=>s.toLowerCase()).sort(),['ryan.biederman@locality.com','todd.logsdon@locality.com']);
  assert.throws(()=>recipientGroups([{repId:r.id,templateId:'radio-multi'}],d,sourceTemplates()),/confirm|compatible/i);
});

test('crossed-out source contacts stay out of research selection even when the directory marks them active',()=>{
  const d=initial();
  for(const name of ['Marnie Cohen','Joe Borgwardt','Emily Michell','Mike McCarthy']) {
    const r=d.reps.find(r=>r.name===name)!;assert.equal(isResearchContact({...r,active:true}),false,name);
  }
  assert.equal(isResearchContact(d.reps.find(r=>r.name==='John Wahlert')!),true);
});
