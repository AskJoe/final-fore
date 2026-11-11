import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { snapshot, edit, recalculate } from '../lib/domain/workbook';
import * as orders from '../lib/domain/orders';
import * as campaigns from '../lib/domain/campaigns';
import * as campaignOrders from '../lib/domain/campaign-orders';
import { Calculator, parse } from '../lib/domain/formulas';
import { Conflict, InputError, type Workbook } from '../lib/domain/types';
const read=(name:string)=>JSON.parse(fs.readFileSync('.local-migration/'+name+'.json','utf8'));
function close(actual:any,expected:any,path='root') {
  if(typeof expected==='number'&&typeof actual==='number'){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(1e-6,Math.abs(expected)*1e-10),`${path}: ${actual} != ${expected}`);return;}
  if(expected===null||typeof expected!=='object'){assert.equal(actual,expected,path);return;}
  assert.equal(Array.isArray(actual),Array.isArray(expected),path);assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path+' keys');
  for(const key of Object.keys(expected))close(actual[key],expected[key],path+'.'+key);
}
test('all workbook views match Python snapshots, including editable-cell policies and issues',()=>{const w:Workbook=read('workbook'),expected=read('reference-workbook');for(const name of ['EPIC3','Markets','Variables'])close(snapshot(w,name),expected[name]);});
test('all 5,827 formulas recalculate to the existing stored values',()=>{const w:Workbook=read('workbook'),calc=new Calculator(w.sheets);let count=0;for(const [s,cells] of Object.entries(w.sheets))for(const [a,c] of Object.entries(cells)){if(c.formula){close(calc.cell(s,a),c.value,s+'!'+a);count++;}}assert.equal(count,5827);});
test('all 28 workbook orders match independent Python models',(t)=>{
  const w=read('workbook'),expected=read('reference-orders');
  const fixtureDate=(Object.values(expected)[0] as {details:{orderDate:string}}).details.orderDate;
  t.mock.timers.enable({apis:['Date'],now:new Date(fixtureDate+'T12:00:00Z')});
  for(const [row,result] of Object.entries(expected))close(orders.snapshot(w,row),result,'order '+row);
});
test('all saved campaigns match Python allocation and channel calculations',()=>{const records=read('campaigns'),expected=read('reference-campaigns');records.forEach((r:any,i:number)=>close(campaigns.calculate(r.details),expected[i],'campaign '+r.id));});
test('blank and funded campaign variants match Python',()=>{for(const v of read('reference-campaign-variants'))close(campaigns.calculate(v.input),v.expected);});
test('saved campaign orders match Python snapshots',()=>{const records=read('campaign-orders'),expected=read('reference-campaign-orders');records.forEach((r:any,i:number)=>close(campaignOrders.model(r.source,r.details,r.revision),expected[i]));});
test('input edits preserve formulas, linked Markets values, and reject stale revisions',()=>{const w:Workbook=read('workbook'),revision=w.metadata.revision,old=w.sheets.EPIC3.DP8.value;edit(w,'cell',{address:'DP8',text:String(old+100),revision});assert.equal(w.metadata.revision,revision+1);assert.equal(w.sheets.EPIC3.DP8.value,old+100);assert.equal(w.sheets.EPIC3.DR8.value,(old+100)/w.sheets.EPIC3.B8.value*1000);assert.throws(()=>edit(w,'cell',{address:'DP8',text:'10',revision}),Conflict);assert.throws(()=>edit(w,'cell',{address:'DR8',text:'10',revision:revision+1}),InputError);assert.throws(()=>edit(w,'cell',{address:'DP8',text:'=1',revision:revision+1}),InputError);});
test('formula edits reject circular and out-of-bounds references',()=>{const w:Workbook=read('workbook');assert.throws(()=>edit(structuredClone(w),'formula',{address:'DR8',text:'=DR8',revision:w.metadata.revision}),/circular/);assert.throws(()=>edit(structuredClone(w),'formula',{address:'DR8',text:'=ZZZ99999',revision:w.metadata.revision}),/outside/);assert.throws(()=>parse('=SUM('),InputError);});
test('variable dates and billing weeks recalculate linked worksheets',()=>{const w:Workbook=read('workbook');edit(w,'variable',{address:'E8',text:'2026-03-02',revision:w.metadata.revision});assert.equal(w.sheets.Markets.G8.value,w.sheets.Variables.E8.value);assert.throws(()=>edit(w,'variable',{address:'K8',text:'54',revision:w.metadata.revision}),/53/);assert.throws(()=>edit(w,'variable',{address:'E8',text:'2026-02-30',revision:w.metadata.revision}),/valid date/);});
test('cent allocation, fees, order schedules, and refresh conflicts',()=>{
  assert.deepEqual(campaigns.distribute(100,{a:1,b:1,c:1}),{a:34,b:33,c:33});
  const d=campaigns.defaults();Object.assign(d,{id:'test',revision:1,budget:1000000,start:'2027-03-01',end:'2027-03-28',markets:[{marketId:'custom-test',name:'Test city',region:'Mid',start:'',end:'',override:1000000,channels:{r3:100000,r4:200000,r22:460000,r8:240000}}]});
  const src=campaignOrders.source(d,'custom-test'),details=campaignOrders.defaults();details.broadcast=[{id:'station1',channel:'r4',station:'KXYZ',program:'News',rate:10000,spotsWeek:5,spotsDay:1,audience:2.5}];
  const result=campaignOrders.model(src,details,0);assert.equal(result.total,900000);assert.equal(result.fees,60000);assert.equal(result.source.reserve,100000);assert.equal(result.broadcast[0].total,200000);assert.equal(result.broadcast[0].impressions,50000);
  const payload={campaignId:'test',marketId:'custom-test',revision:1,sourceRevision:1,details};const saved={revision:1,source:src,details};d.revision=2;d.markets[0].channels.r22=360000;d.markets[0].channels.r8=340000;
  assert.equal(campaignOrders.preview(payload,saved,d).sourceRevision,1);assert.equal(campaignOrders.preview({...payload,refresh:true},saved,d).sourceRevision,2);assert.throws(()=>campaignOrders.preview({...payload,revision:0},saved,d),Conflict);
});
