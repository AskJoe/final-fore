import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { startResearchFlowFixture } from './research-flow-fixture';
import { ingestReceivedEmail } from '../lib/research/inbound';
import { hashToken, seal, unseal } from '../lib/research/secrets';

test('received reply and Gmail response persist once, with separate relay legs and no mailbox access',async()=>{
  const fixture=await startResearchFlowFixture(0);
  try{
    const db=createClient(fixture.url,'fixture-service-key',{auth:{persistSession:false,autoRefreshToken:false}}),key=Buffer.alloc(32,1),id=randomUUID(),externalToken='b'.repeat(64),staffToken='c'.repeat(64);
    const routing={externalToken,staffToken,sarahEmail:'sarah@example.test',from:'Sarah <research@example.test>',replyDomain:'reply.example.test'};
    const config={origin:'https://app.example.test',...routing,secretKey:key};
    fixture.tables.ff_research_conversations.push({id,mode:'live',manifest:{markets:[{marketId:'epic3-lincoln',displayName:'Lincoln, NE'}]},recipient:{to:'rep@example.test',cc:[]},portal_state:'open'});
    fixture.tables.ff_research_secrets.push({conversation_id:id,external_reply_hash:hashToken(externalToken),staff_reply_hash:hashToken(staffToken),ciphertext:seal(routing,key)});
    const original=randomUUID();fixture.tables.ff_research_messages.push({id:original,conversation_id:id,author_kind:'staff',state:'recorded',created_at:'2026-11-11T00:00:00Z'});
    for(const leg of ['vendor','gmail'])fixture.tables.ff_research_deliveries.push({id:randomUUID(),message_id:original,leg,state:'sent',provider_id:'provider-'+leg,rfc_message_id:'<initial-'+leg+'@example.test>',created_at:'2026-11-11T00:00:00Z'});
    const messages:Record<string,any>={rep:{id:'rep',from:'John <rep@example.test>',to:['reply-'+externalToken+'@reply.example.test'],cc:[],subject:'Research',text:'Here are the rates.',html:'<p>Here are the rates.</p><img src="https://tracker.example/test">',headers:{},message_id:'<rep-reply@example.test>',attachments:[],authentication:{dkim:'pass'}},staff:{id:'staff',from:'Sarah <sarah@example.test>',to:['staff-'+staffToken+'@reply.example.test'],cc:[],subject:'Re: Research',text:'Thank you.\n\nOn Tuesday staff-'+staffToken+'@reply.example.test wrote:',html:'',headers:{'In-Reply-To':'<initial-gmail@example.test>'},message_id:'<sarah-reply@example.test>',attachments:[],authentication:{dkim:'pass'}}};
    const reads:string[]=[];const resend={emails:{receiving:{get:async(emailId:string)=>{reads.push(emailId);return {data:messages[emailId],error:null};}},get:async()=>{throw new Error('Persisted RFC IDs should be reused.');}}} as any;
    await ingestReceivedEmail(db,resend,'rep',config,async()=>true);await ingestReceivedEmail(db,resend,'rep',config,async()=>true);
    const rep=fixture.tables.ff_research_messages.find(m=>m.received_email_id==='rep');assert.equal(rep.body_text,'Here are the rates.');assert.ok(!rep.body_html.includes('tracker'));
    const gmail=fixture.tables.ff_research_deliveries.filter(d=>d.message_id===rep.id);assert.equal(gmail.length,1);assert.equal(gmail[0].leg,'gmail');assert.deepEqual(unseal<any>(gmail[0].payload_ciphertext,key).to,['sarah@example.test']);
    await ingestReceivedEmail(db,resend,'staff',config,async()=>true);await ingestReceivedEmail(db,resend,'staff',config,async()=>true);
    const staff=fixture.tables.ff_research_messages.find(m=>m.received_email_id==='staff'),vendor=fixture.tables.ff_research_deliveries.filter(d=>d.message_id===staff.id);assert.equal(vendor.length,1);assert.equal(vendor[0].leg,'vendor');
    const payload=unseal<any>(vendor[0].payload_ciphertext,key);assert.deepEqual(payload.to,['rep@example.test']);assert.ok(!payload.text.includes(staffToken));assert.equal(payload.headers['In-Reply-To'],'<rep-reply@example.test>');
    assert.deepEqual(reads,['rep','staff']);assert.equal(fixture.tables.ff_research_messages.length,3);
  }finally{await fixture.close();}
});
