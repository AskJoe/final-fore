import test from 'node:test';
import assert from 'node:assert/strict';
import { testEmailAddresses,providerPayload } from '../lib/research/send-policy';
import { buildTestEmail } from '../lib/research/test-send';
import { resendTransport,type MailPayload } from '../lib/research/delivery';
import { sourceTemplates } from '../lib/research/templates';

const identity='sarah@finalforemedia.com';
const email:MailPayload={from:identity,replyTo:identity,to:['tester@example.com'],cc:[],subject:'Test',text:'Content',testRecipients:['tester@example.com']};
test('test recipients must be explicitly entered and never default to a vendor or Sarah',()=>{
  for(const raw of ['',null,[], 'Name <one@example.com>', 'one@example.com\rBcc:vendor@example.com', Array.from({length:11},(_,i)=>`person${i}@example.com`).join(',')])assert.throws(()=>testEmailAddresses(raw));
  assert.deepEqual(testEmailAddresses('One@example.com; two@example.com\none@example.com'),['one@example.com','two@example.com']);
});
test('provider boundary blocks legacy deliveries, added vendor/CC/BCC recipients and changed identity',()=>{
  for(const bad of [
    {...email,testRecipients:undefined},
    {...email,to:['vendor@example.com']},
    {...email,to:['tester@example.com','vendor@example.com']},
    {...email,cc:['vendor@example.com']},
    {...email,bcc:['vendor@example.com']},
    {...email,replyTo:'route@example.com'},
    {...email,from:'different@example.com'},
  ])assert.throws(()=>providerPayload(bad,true,identity));
  const valid=providerPayload(email,true,identity);
  assert.deepEqual(valid.to,['tester@example.com']);assert.deepEqual(valid.cc,[]);
  assert.ok(!('testRecipients' in valid));
});
test('test email retains source content and cities but replaces every delivery recipient',()=>{
  const template=sourceTemplates().find(t=>t.id==='tv-multi')!;
  for(const k of Object.keys(template.defaults))if(!template.defaults[k])template.defaults[k]='Test field';
  const recipient={templateId:template.id,repId:'rep',firmId:'firm',firmName:'Vendor Firm',name:'John Rep',to:'vendor@example.com',cc:['vendor-cc@example.com']};
  const payload=buildTestEmail(template,recipient,'2026-12-01','https://app.example.com/research-upload/test-token',['tester@example.com'],{from:identity,sarahEmail:identity,origin:'https://app.example.com',replyDomain:'finalforemedia.com',secretKey:Buffer.alloc(32)});
  assert.deepEqual(payload.to,['tester@example.com']);assert.deepEqual(payload.cc,[]);
  assert.equal(payload.from,identity);assert.equal(payload.replyTo,identity);
  assert.ok(payload.subject.startsWith('[TEST] '));
  assert.match(payload.html!,/<ol/);assert.match(payload.html!,/<ul/);
  for(const market of template.markets)assert.ok(payload.text.includes(market.displayName),market.displayName);
  assert.ok(payload.text.includes('https://app.example.com/research-upload/test-token'));
});
test('blocked queue payload never reaches Resend even when sending is enabled',async()=>{
  const prior=process.env.FINAL_FORE_RESEARCH_TEST_ONLY;process.env.FINAL_FORE_RESEARCH_TEST_ONLY='1';
  let calls=0;
  const client={emails:{send:async()=>{calls++;return {data:{id:'fake-provider'},error:null};}}};
  try{
    const transport=resendTransport(client as any,()=>true);
    const blocked=await transport.send({...email,testRecipients:undefined},'legacy');
    assert.deepEqual(blocked,{error:'Test mode blocked a non-test email.',status:403});assert.equal(calls,0);
    assert.deepEqual(await transport.send(email,'test'),{id:'fake-provider'});assert.equal(calls,1);
  }finally{if(prior===undefined)delete process.env.FINAL_FORE_RESEARCH_TEST_ONLY;else process.env.FINAL_FORE_RESEARCH_TEST_ONLY=prior;}
});
