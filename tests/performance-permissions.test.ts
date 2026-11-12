import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordPayloadCache} from '../lib/record-cache';
import {SupabaseStore,StorageError,type StoredRecord} from '../lib/store';
import {requestOrigin} from '../lib/request-origin';
import type {SupabaseClient} from '@supabase/supabase-js';

const row=(id='a',version=1):StoredRecord=>({id,kind:'report_chunk',version,updated_at:'2026-11-11T00:00:00Z',payload:{records:[{value:version}]}});
function database(){
  let rows=[row(),row('b')],denied=false;const reads:string[]=[];
  const db={from(){let selected='*',filters:((r:StoredRecord)=>boolean)[]=[],single=false,start=0,end=999;
    const query={select(s:string){selected=s;return query;},eq(k:keyof StoredRecord,v:unknown){filters.push(r=>r[k]===v);return query;},in(k:keyof StoredRecord,values:unknown[]){filters.push(r=>values.includes(r[k]));return query;},order(){return query;},range(a:number,b:number){start=a;end=b;return query;},maybeSingle(){single=true;return query;},then(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown){reads.push(selected);const data=rows.filter(r=>filters.every(f=>f(r))).slice(start,end+1).map(r=>selected==='*'?structuredClone(r):Object.fromEntries(selected.split(',').map(k=>[k,r[k as keyof StoredRecord]])));return Promise.resolve(denied?{data:null,error:{message:'Denied'}}:{data:single?data[0]??null:data,error:null}).then(resolve,reject);}};return query;}} as unknown as SupabaseClient;
  return {db,reads,setRows:(v:StoredRecord[])=>{rows=v;},deny:()=>{denied=true;}};
}
test('cached records recheck RLS and versions, isolate edits and fail closed',async()=>{
  const mock=database(),store=new SupabaseStore(mock.db,new RecordPayloadCache());
  const first=await store.get('a');first!.payload.records[0].value=999;
  assert.equal((await store.get('a'))!.payload.records[0].value,1);
  assert.deepEqual(mock.reads,['*','id,kind,version,updated_at']);
  mock.setRows([row('a',2)]);assert.equal((await store.get('a'))!.payload.records[0].value,2);
  mock.setRows([]);assert.equal(await store.get('a'),null);
  mock.deny();await assert.rejects(()=>store.get('a'),StorageError);
});
test('cached lists include only currently accessible rows and fetch only changed payloads',async()=>{
  const mock=database(),store=new SupabaseStore(mock.db,new RecordPayloadCache());
  assert.equal((await store.list('report_chunk')).length,2);
  assert.equal((await store.list('report_chunk')).length,2);
  assert.deepEqual(mock.reads,['*','id,kind,version,updated_at']);
  mock.setRows([row('b',2),row('c')]);const changed=await store.list('report_chunk');
  assert.deepEqual(changed.map(r=>r.id),['b','c']);assert.equal(changed[0].payload.records[0].value,2);
  mock.deny();await assert.rejects(()=>store.list('report_chunk'),StorageError);
});
test('payload cache stays bounded and rejects mismatched metadata',()=>{
  const cache=new RecordPayloadCache(35);cache.put(row('a'));cache.put(row('b'));
  assert.equal(cache.has('a'),false);assert.ok(cache.read(row('b')));
  assert.equal(cache.read({...row('b'),kind:'workbook'}),null);
  assert.equal(cache.read({...row('b'),updated_at:'different'}),null);
});
test('hosted preview and CSRF origin exclude internal ports and untrusted host headers',()=>{
  const request=new Request('http://localhost:10000/api/research/template-preview',{headers:{host:'final-fore.onrender.com','x-forwarded-host':'attacker.test'}});
  assert.equal(requestOrigin(request,'https://final-fore.onrender.com'),'https://final-fore.onrender.com');
  assert.equal(requestOrigin(new Request('https://localhost:10000/x',{headers:{host:'final-fore.onrender.com'}}),''),'https://final-fore.onrender.com');
  assert.equal(requestOrigin(new Request('http://localhost:3107/x',{headers:{host:'127.0.0.1:3000'}}),''),'http://127.0.0.1:3000');
});
