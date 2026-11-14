import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { startResearchFlowFixture } from './research-flow-fixture';
import { ingestReceivedEmail } from '../lib/research/inbound';
import { ResearchUploads } from '../lib/research/uploads';
import { hashToken, seal } from '../lib/research/secrets';
import { runResearchWorkerOnce } from '../lib/research/worker';

async function setup(t:TestContext,gmailState='sent'){
  const fixture=await startResearchFlowFixture(0),db=createClient(fixture.url,'fixture-service-key',{auth:{persistSession:false,autoRefreshToken:false}}),key=Buffer.alloc(32,1),id=randomUUID(),portalToken='a'.repeat(64),externalToken='b'.repeat(64),staffToken='c'.repeat(64);
  const routing={externalToken,staffToken,sarahEmail:'sarah@example.test',from:'Sarah <research@example.test>',replyDomain:'reply.example.test'},config={origin:'https://app.example.test',...routing,secretKey:key};
  fixture.tables.ff_research_conversations.push({id,mode:'live',manifest:{markets:[{marketId:'epic3-lincoln',displayName:'Lincoln, NE'}]},recipient:{to:'rep@example.test',cc:[]},portal_state:'open'});
  fixture.tables.ff_research_secrets.push({conversation_id:id,portal_hash:hashToken(portalToken),external_reply_hash:hashToken(externalToken),staff_reply_hash:hashToken(staffToken),ciphertext:seal(routing,key)});
  const original=randomUUID();fixture.tables.ff_research_messages.push({id:original,conversation_id:id,author_kind:'staff',state:'recorded',created_at:'2026-11-11T00:00:00Z'});
  for(const leg of ['vendor','gmail'])fixture.tables.ff_research_deliveries.push({id:randomUUID(),message_id:original,leg,state:leg==='gmail'?gmailState:'sent',provider_id:leg==='gmail'&&gmailState==='failed'?null:'provider-'+leg,rfc_message_id:leg==='gmail'&&gmailState==='failed'?null:'<initial-'+leg+'@example.test>',created_at:'2026-11-11T00:00:00Z'});
  const messages:Record<string,any>={},bytes=Buffer.from('Research file retained with exact bytes.');
  const originalFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:input.toString());if(u.hostname==='attachment-fixture.resend.com')return new Response(bytes);return originalFetch(input,init);};
  t.after(async()=>{globalThis.fetch=originalFetch;await fixture.close();});
  const resend={emails:{receiving:{get:async(emailId:string)=>({data:messages[emailId],error:null}),attachments:{get:async()=>({data:{download_url:'https://attachment-fixture.resend.com/file'},error:null})}},get:async()=>({data:null,error:{message:'Not available'}})}} as any;
  function message(emailId:string,staff=false,attachment=true){const m={id:emailId,from:staff?'Sarah <sarah@example.test>':'Rep <rep@example.test>',to:[(staff?'staff-'+staffToken:'reply-'+externalToken)+'@reply.example.test'],cc:[] as string[],subject:'Research',text:'Please see attached.',html:'',headers:{} as Record<string,string>,message_id:'<'+emailId+'@example.test>',attachments:attachment?[{id:'file-'+emailId,filename:'rates.txt',content_type:'text/plain'}]:[],authentication:{dkim:'pass',dmarc:'pass'}};messages[emailId]=m;return m;}
  return {fixture,db,id,portalToken,config,resend,message,bytes};
}

test('held staff attachment is retained internally but never listed or downloaded by the rep',async t=>{
  const s=await setup(t),m=s.message('held',true);m.cc=['unexpected@example.test'];
  await ingestReceivedEmail(s.db,s.resend,m.id,s.config,async()=>true);
  const recorded=s.fixture.tables.ff_research_messages.find(r=>r.received_email_id===m.id);assert.equal(recorded.state,'held');assert.equal(recorded.attachment_ids.length,1);
  const uploads=new ResearchUploads(s.db),portal=await uploads.portal(s.portalToken);assert.deepEqual(await uploads.files(portal),[]);
  await assert.rejects(uploads.download(portal,recorded.attachment_ids[0]),/not ready/);
});
test('repeated attachment bytes reuse a file and retain both message associations',async t=>{
  const s=await setup(t);s.message('first');s.message('repeat');
  await ingestReceivedEmail(s.db,s.resend,'first',s.config,async()=>true);await ingestReceivedEmail(s.db,s.resend,'repeat',s.config,async()=>true);
  const messages=s.fixture.tables.ff_research_messages.filter(m=>m.received_email_id);assert.equal(messages.length,2);assert.ok(messages.every(m=>m.state==='recorded'));assert.equal(s.fixture.tables.ff_research_files.length,1);assert.deepEqual(messages[0].attachment_ids,messages[1].attachment_ids);assert.equal(s.fixture.objects.size,1);
});
test('submitting an internal attachment hash cannot promote its object into the public portal',async t=>{
  const s=await setup(t),m=s.message('private',true);m.cc=['unexpected@example.test'];await ingestReceivedEmail(s.db,s.resend,m.id,s.config,async()=>true);
  const internal=s.fixture.tables.ff_research_files[0],uploads=new ResearchUploads(s.db);
  const reservation=await uploads.reserve(s.portalToken,{marketId:'epic3-lincoln',name:'my-file.txt',size:s.bytes.length,sha256:createHash('sha256').update(s.bytes).digest('hex')});
  assert.notEqual(reservation.file.id,internal.id);assert.ok(reservation.grant);assert.equal(reservation.file.state,'uploading');assert.equal(reservation.file.name,'my-file.txt');
  const portal=await uploads.portal(s.portalToken);assert.ok((await uploads.files(portal)).every(f=>f.id!==internal.id));
});
test('a failed initial Gmail copy does not block rep reply or attachment retention',async t=>{
  const s=await setup(t,'failed');s.message('rep-after-gmail-failure');await ingestReceivedEmail(s.db,s.resend,'rep-after-gmail-failure',s.config,async()=>true);
  const m=s.fixture.tables.ff_research_messages.find(m=>m.received_email_id==='rep-after-gmail-failure');assert.equal(m.state,'recorded');assert.equal(m.attachment_ids.length,1);assert.ok(s.fixture.tables.ff_research_deliveries.some(d=>d.message_id===m.id&&d.leg==='gmail'));
});
test('staff reply referencing another conversation’s outgoing RFC ID is held',async t=>{
  const s=await setup(t),other=randomUUID(),messageId=randomUUID();s.fixture.tables.ff_research_messages.push({id:messageId,conversation_id:other,author_kind:'staff'});s.fixture.tables.ff_research_deliveries.push({id:randomUUID(),message_id:messageId,rfc_message_id:'<other-gmail@example.test>',leg:'gmail',state:'sent'});
  const m=s.message('wrong-thread',true,false);m.headers={'In-Reply-To':'<other-gmail@example.test>'};await ingestReceivedEmail(s.db,s.resend,m.id,s.config,async()=>true);
  const recorded=s.fixture.tables.ff_research_messages.find(r=>r.received_email_id===m.id);assert.equal(recorded.state,'held');assert.ok(!s.fixture.tables.ff_research_deliveries.some(d=>d.message_id===recorded.id&&d.leg==='vendor'));
});
test('unknown direct reply reference is held until its conversation can be verified',async t=>{
  const s=await setup(t),m=s.message('unknown-parent',true,false);m.headers={'In-Reply-To':'<not-yet-indexed-other-thread@example.test>'};await ingestReceivedEmail(s.db,s.resend,m.id,s.config,async()=>true);
  const recorded=s.fixture.tables.ff_research_messages.find(r=>r.received_email_id===m.id);assert.equal(recorded.state,'held');assert.ok(!s.fixture.tables.ff_research_deliveries.some(d=>d.message_id===recorded.id&&d.leg==='vendor'));
});
test('recovery progresses beyond twenty abandoned upload reservations',async t=>{
  const s=await setup(t),previous={writes:process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED,send:process.env.FINAL_FORE_RESEARCH_SEND_ENABLED};process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED='1';process.env.FINAL_FORE_RESEARCH_SEND_ENABLED='0';t.after(()=>{if(previous.writes===undefined)delete process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED;else process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED=previous.writes;if(previous.send===undefined)delete process.env.FINAL_FORE_RESEARCH_SEND_ENABLED;else process.env.FINAL_FORE_RESEARCH_SEND_ENABLED=previous.send;});
  for(let i=0;i<21;i++)s.fixture.tables.ff_research_files.push({id:randomUUID(),conversation_id:s.id,object_key:'pending-'+i,size:s.bytes.length,state:'uploading',created_at:'2026-01-01T00:00:00Z',recovery_checked_at:null});
  const completed=s.fixture.tables.ff_research_files[20];s.fixture.objects.set(completed.object_key,s.bytes);
  await runResearchWorkerOnce(s.db,s.resend,s.config,async()=>true);await runResearchWorkerOnce(s.db,s.resend,s.config,async()=>true);
  assert.equal(completed.state,'checking');assert.equal(s.fixture.tables.ff_research_files.filter(f=>f.state==='uploading').length,20);
});
