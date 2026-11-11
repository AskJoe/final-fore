import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { acceptWebhook } from '../lib/research/webhooks';
const key=randomBytes(32),secret='whsec_'+key.toString('base64');
function signed(body:string){const id='event-1',timestamp=String(Math.floor(Date.now()/1000));return {'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+createHmac('sha256',key).update(id+'.'+timestamp+'.'+body).digest('base64')};}
test('signed webhook is durably accepted once; signature failure never reaches storage',async()=>{
  const body=JSON.stringify({type:'email.received',created_at:new Date().toISOString(),data:{email_id:'email-1',to:['reply-token@example.test']}}),seen=new Set<string>();let attempts=0;
  const store={async accept(id:string){attempts++;if(seen.has(id))return false;seen.add(id);return true;}};
  assert.equal(await acceptWebhook(body,signed(body),secret,store),true);
  assert.equal(await acceptWebhook(body,signed(body),secret,store),false);
  await assert.rejects(acceptWebhook(body+' ',signed(body),secret,store),/signature|verify|Invalid/i);
  assert.equal(attempts,2);
});
test('storage failure propagates so the provider can retry instead of losing the event',async()=>{
  const body=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'email-1'}});
  await assert.rejects(acceptWebhook(body,signed(body),secret,{accept:async()=>{throw new Error('Database unavailable');}}),/Database unavailable/);
});
