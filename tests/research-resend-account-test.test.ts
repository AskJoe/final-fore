import test from 'node:test';
import assert from 'node:assert/strict';
import { providerPayload,testEmailIdentity } from '../lib/research/send-policy';
import { buildTestEmail } from '../lib/research/test-send';
import { resendTransport,type MailPayload } from '../lib/research/delivery';
import { sourceTemplates } from '../lib/research/templates';

const sarah='sarah@finalforemedia.com',account='owner@example.com';
const payload:MailPayload={from:'onboarding@resend.dev',replyTo:account,to:[account],cc:[],subject:'[TEST] Research',text:'Test',testRecipients:[account]};

test('temporary Resend sender requires test mode and one configured account address',()=>{
  assert.deepEqual(testEmailIdentity(sarah,true,account),{from:'onboarding@resend.dev',replyTo:account,allowedRecipient:account});
  assert.throws(()=>testEmailIdentity(sarah,false,account),/only available in test mode/);
  assert.throws(()=>testEmailIdentity(sarah,true,'one@example.com,two@example.com'),/one Resend account/);
  assert.throws(()=>testEmailIdentity(sarah,true,'invalid'),/valid test email/);
  assert.deepEqual(testEmailIdentity(sarah,true),{from:sarah,replyTo:sarah,allowedRecipient:undefined});
});

test('temporary sender blocks other entered addresses, Sarah copies, changed headers and old jobs',()=>{
  for(const bad of [
    {...payload,to:['other@example.com'],testRecipients:['other@example.com']},
    {...payload,to:[account,'vendor@example.com'],testRecipients:[account,'vendor@example.com']},
    {...payload,cc:[sarah]}, {...payload,bcc:[sarah]},
    {...payload,replyTo:sarah}, {...payload,from:sarah},
    {...payload,testRecipients:undefined},
  ])assert.throws(()=>providerPayload(bad,true,sarah,account));
  assert.deepEqual(providerPayload(payload,true,sarah,account).to,[account]);
  assert.throws(()=>providerPayload(payload,false,sarah,account),/only available in test mode/);
});

test('temporary test email keeps template markets and removes vendor delivery recipients',()=>{
  const template=sourceTemplates().find(t=>t.id==='tv-multi')!;
  for(const key of Object.keys(template.defaults))if(!template.defaults[key])template.defaults[key]='Test value';
  const recipient={templateId:template.id,repId:'rep',firmId:'firm',firmName:'Test Firm',name:'John Rep',to:'vendor@example.com',cc:['vendor-cc@example.com']};
  const config={from:sarah,sarahEmail:sarah,origin:'https://app.example.com',replyDomain:'finalforemedia.com',secretKey:Buffer.alloc(32),testAccount:account};
  const email=buildTestEmail(template,recipient,'2026-12-01','https://app.example.com/research-upload/test',[account],config);
  assert.equal(email.from,'onboarding@resend.dev');assert.equal(email.replyTo,account);
  assert.deepEqual(email.to,[account]);assert.deepEqual(email.cc,[]);
  for(const market of template.markets)assert.ok(email.text.includes(market.displayName));
  assert.throws(()=>buildTestEmail(template,recipient,'2026-12-01','https://app.example.com/research-upload/test',['other@example.com'],config),/only allows test delivery/);
});

test('worker rechecks the temporary account restriction before any Resend call',async()=>{
  const keys=['FINAL_FORE_RESEARCH_TEST_ONLY','FINAL_FORE_RESEARCH_SARAH_EMAIL','FINAL_FORE_RESEARCH_RESEND_TEST_ACCOUNT'];
  const before=keys.map(k=>process.env[k]);
  process.env[keys[0]]='1';process.env[keys[1]]=sarah;process.env[keys[2]]=account;
  const sent:MailPayload[]=[];
  const client={emails:{send:async(p:MailPayload)=>{sent.push(p);return {data:{id:'test-provider-id'},error:null};}}};
  try{
    const transport=resendTransport(client as any,()=>true);
    const blocked=await transport.send({...payload,to:['vendor@example.com'],testRecipients:['vendor@example.com']},'blocked');
    assert.ok('error' in blocked);assert.equal(sent.length,0);
    assert.deepEqual(await transport.send(payload,'allowed'),{id:'test-provider-id'});
    assert.equal(sent.length,1);assert.equal(sent[0].replyTo,account);assert.deepEqual(sent[0].to,[account]);
  }finally{keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});}
});
