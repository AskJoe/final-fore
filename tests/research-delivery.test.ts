import test from 'node:test';
import assert from 'node:assert/strict';
import { processDelivery, type Delivery, type DeliveryRepository, type DeliveryState, type MailTransport } from '../lib/research/delivery';

const now=new Date('2026-11-11T12:00:00Z');
class Repo implements DeliveryRepository {
  row:Delivery={id:'delivery-1',state:'queued',idempotencyKey:'research/message-1/vendor',firstAttemptAt:null,payload:{from:'Sarah <research@example.test>',to:['rep@example.test'],subject:'Research',text:'Full email',replyTo:'reply-token@example.test'},providerId:null};
  locked=false;
  async claim(){if(this.locked)return null;this.locked=true;return structuredClone(this.row);}
  async recordAttempt(_id:string,at:string){this.row.firstAttemptAt??=at;this.row.state='sending';}
  async finish(_id:string,state:DeliveryState,changes:Partial<Delivery>={}){Object.assign(this.row,changes,{state});this.locked=false;}
}
test('sending gate makes no provider call and leaves queued data unchanged',async()=>{
  const repo=new Repo();let calls=0;
  const result=await processDelivery('delivery-1',repo,{send:async()=>{calls++;return {id:'provider-1'};}},false,now);
  assert.equal(result,'disabled');assert.equal(calls,0);assert.equal(repo.row.state,'queued');assert.equal(repo.locked,false);
});
test('send retries use a stable idempotency key after an uncertain network outcome',async()=>{
  const repo=new Repo(),keys:string[]=[];let attempt=0;
  const transport:MailTransport={send:async(_payload,key)=>{keys.push(key);if(attempt++===0)throw new Error('Connection closed after acceptance');return {id:'provider-1'};}};
  assert.equal(await processDelivery('delivery-1',repo,transport,true,now),'uncertain');
  assert.equal(await processDelivery('delivery-1',repo,transport,true,new Date(now.getTime()+60000)),'sent');
  assert.deepEqual(keys,['research/message-1/vendor','research/message-1/vendor']);assert.equal(repo.row.providerId,'provider-1');
  assert.equal(await processDelivery('delivery-1',repo,transport,true,now),'sent');assert.equal(keys.length,2);
});
test('uncertain attempts older than the provider retention window require reconciliation',async()=>{
  const repo=new Repo();repo.row.state='uncertain';repo.row.firstAttemptAt='2026-11-10T11:00:00Z';
  let called=false;
  assert.equal(await processDelivery('delivery-1',repo,{send:async()=>{called=true;return {id:'wrong'};}},true,now),'needs-review');
  assert.equal(called,false);
});
test('delivery leases prevent concurrent workers sending the same job',async()=>{
  const repo=new Repo();let calls=0;let release:()=>void=()=>{};const wait=new Promise<void>(r=>{release=r;});
  const transport:MailTransport={send:async()=>{calls++;await wait;return {id:'provider-1'};}};
  const first=processDelivery('delivery-1',repo,transport,true,now);
  await new Promise(r=>setImmediate(r));assert.equal(await processDelivery('delivery-1',repo,transport,true,now),'busy');release();await first;assert.equal(calls,1);
});
test('provider rejection and retryable errors are distinct from uncertain delivery',async()=>{
  for(const [status,expected] of [[429,'retry'],[503,'retry'],[422,'failed']] as const){
    const repo=new Repo();assert.equal(await processDelivery('delivery-1',repo,{send:async()=>({error:'Provider error',status})},true,now),expected);
  }
});

test('attempt is persisted before calling the provider so a crashed worker can recover safely',async()=>{
  const repo=new Repo();
  await processDelivery('delivery-1',repo,{send:async()=>{assert.equal(repo.row.firstAttemptAt,now.toISOString());assert.equal(repo.row.state,'sending');return {id:'provider-1'};}},true,now);
});
