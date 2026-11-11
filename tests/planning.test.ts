import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Service } from '../lib/service';
import { MemoryStore } from './memory-store';
import { initial } from '../lib/domain/directory';
import { combined } from '../lib/domain/planning';
import { Conflict, InputError } from '../lib/domain/types';

function fixture(){
  const a=JSON.parse(fs.readFileSync('.local-migration/workbook.json','utf8')),b=structuredClone(a),directory=initial();
  b.metadata.clientId='second-client';
  directory.clients.push({id:'second-client',name:'Second Client',brand:'Another Brand',marketIds:[],active:true,notes:'',source:''},{id:'empty-client',name:'Empty Client',brand:'',marketIds:[],active:true,notes:'',source:''});
  const store=new MemoryStore([{id:'workbook',kind:'workbook',payload:a},{id:'workbook:second-client',kind:'workbook',payload:b},{id:'directory',kind:'directory',payload:directory}]);
  return {store,service:new Service(store)};
}
test('combined planning retains both clients and independent source addresses, rates and values',async()=>{
  const {service,store}=fixture(),grid=await service.get('planning',new URLSearchParams());
  assert.equal(grid.sources.length,2);assert.equal(grid.clients.length,3);
  const periods=grid.periods.filter((p:any)=>p.market==='Austin, TX'&&p.year===2026);assert.equal(periods.length,2);assert.notEqual(periods[0].id,periods[1].id);
  assert.match(periods[0].label,/Epic3/);assert.match(periods[1].label,/Second Client/);
  const targets=Object.entries(grid.targets).filter(([,t]:any)=>t.address==='DP8') as [string,any][];
  assert.equal(targets.length,2);assert.notEqual(targets[0][0],targets[1][0]);
  for(const [address,t] of targets)assert.equal(grid.cells[address].value,(await store.get(t.workbookId))?.payload.sheets.EPIC3.DP8.value);
  assert.equal(grid.sources[0].rateColumn,2);assert.ok(grid.sources[1].rateColumn>grid.sources[0].endColumn);
  assert.ok(!grid.sources.some((s:any)=>s.clientId==='empty-client'));
});
test('combined grid edits and formula recalculation affect only the owning client workbook',async()=>{
  const {service,store}=fixture();const before=structuredClone((await store.get('workbook')));
  const grid=await service.get('planning',new URLSearchParams());
  const target:any=Object.values(grid.targets).find((t:any)=>t.clientId==='second-client'&&t.address==='DP8');
  const updated=await service.post('planning/cell',{...target,text:'4321'});
  assert.equal((await store.get(target.workbookId))?.payload.sheets.EPIC3.DP8.value,4321);
  assert.deepEqual(await store.get('workbook'),before);
  await assert.rejects(service.post('planning/cell',{...target,text:'555'}),Conflict);
  const formulaTarget:any=Object.values(updated.targets).find((t:any)=>t.clientId==='second-client'&&t.address==='DP21');
  const result=await service.post('planning/formula',{...formulaTarget,text:'=DP8*2'});
  const virtual=Object.keys(result.targets).find(a=>result.targets[a].clientId==='second-client'&&result.targets[a].address==='DP21')!;
  assert.equal(result.cells[virtual].value,8642);assert.equal(result.cells[virtual].formula,'=DP8*2');assert.deepEqual(await store.get('workbook'),before);
});
test('workbook ownership is explicit and cannot be changed through a cell save',async()=>{
  const {service,store}=fixture(),grid=await service.get('planning',new URLSearchParams());
  const target:any=Object.values(grid.targets).find((t:any)=>t.clientId==='second-client'&&t.address==='DP8');
  await assert.rejects(service.post('planning/cell',{...target,clientId:'epic3',text:'7'}),InputError);
  const wrong=await store.get('directory');assert.ok(wrong);
  await assert.rejects(service.post('planning/cell',{...target,workbookId:'directory',text:'7'}),InputError);
  const orphan=(await store.get('workbook:second-client'))!;delete orphan.payload.metadata.clientId;
  assert.throws(()=>combined([orphan],initial()),/needs a client assignment/);
});
test('combined grids reject mismatched channel labels instead of mislabeling another client’s values',async()=>{
  const {store}=fixture(),rows=await store.list('workbook');rows[1].payload.sheets.EPIC3.A8.value='Unrelated metric';
  const directory=(await store.get('directory'))!.payload;
  assert.throws(()=>combined(rows,directory as any),/matching channel labels/);
});
