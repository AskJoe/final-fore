import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Service,orderKey,campaignKey } from '../lib/service';
import { MemoryStore } from './memory-store';
import { Conflict } from '../lib/domain/types';
import { SupabaseStore } from '../lib/store';
const records=()=>JSON.parse(fs.readFileSync('.local-migration/records.json','utf8'));
test('service round-trips workbook edits, legacy draft saves, campaigns and orders',async()=>{
  const store=new MemoryStore(records()),service=new Service(store),q=new URLSearchParams();
  const w=await service.get('table',q);const changed=await service.post('cell',{address:'DP8',text:'1234',revision:w.revision});assert.equal(changed.cells.DP8.value,1234);
  assert.equal((await service.get('table',q)).revision,w.revision+1);await assert.rejects(service.post('cell',{address:'DP8',text:'5',revision:w.revision}),Conflict);
  const legacy=await service.get('order',new URLSearchParams({market:'8'}));legacy.details.orderNumber='LOCAL-TEST';await service.post('order',{market:'8',details:legacy.details,sourceRevision:legacy.sourceRevision,draftRevision:legacy.draftRevision});assert.equal((await service.get('order',new URLSearchParams({market:'8'}))).details.orderNumber,'LOCAL-TEST');
  const blank=(await service.get('campaign/catalog',q)).draft.details;blank.budget=1234567;const saved=await service.post('campaign',blank);assert.ok(saved.details.id);assert.equal(saved.details.revision,1);assert.equal(saved.allocated,1234567);
  const existing=(await store.list('campaign_order'))[0];const src=existing.payload.source;const order=await service.get('campaign-order',new URLSearchParams({campaign:src.campaignId,market:src.marketId}));order.details.orderNumber='ORDER-TEST';const savedOrder=await service.post('campaign-order',order);assert.equal(savedOrder.revision,order.revision+1);assert.equal((await store.get(existing.id))?.payload.details.orderNumber,'ORDER-TEST');
});
test('reporting reassembles every row in exact source order',async()=>{const source=JSON.parse(fs.readFileSync('epic3/reporting/web/reporting-data.json','utf8'));assert.deepEqual(await new Service(new MemoryStore(records())).report(),source);});
test('simultaneous writes and dependency changes reject stale saves',async()=>{const store=new MemoryStore(records()),w=(await store.get('workbook'))!;const results=await Promise.allSettled([store.save(w.id,w.kind,w.payload,w.version),store.save(w.id,w.kind,w.payload,w.version)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const c=(await store.list('campaign'))[0];await store.save(c.id,c.kind,c.payload,c.version);await assert.rejects(store.save('new-order','campaign_order',{},0,c),Conflict);});
test('Supabase adapter maps CAS conflicts and forwards source revision dependency',async()=>{
  let sent:any;const db:any={rpc:async(name:string,args:any)=>{sent={name,args};return {error:{code:'40001',message:'source changed'}};}};const store=new SupabaseStore(db);
  await assert.rejects(store.save('o','campaign_order',{},2,{id:'c',kind:'campaign',version:4,payload:{},updated_at:''}),Conflict);assert.equal(sent.name,'ff_save_record');assert.equal(sent.args.p_dependency_version,4);assert.equal(sent.args.p_expected_version,2);
});
test('Supabase adapter maps explicit PostgREST HTTP 409 conflicts',async()=>{
  const db:any={rpc:async()=>({error:{code:'PT409',message:'Record changed'}})};
  await assert.rejects(new SupabaseStore(db).save('c','campaign',{},3),Conflict);
});
