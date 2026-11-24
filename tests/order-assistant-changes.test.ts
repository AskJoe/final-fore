import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanOrderDocument,orderTotal,type OrderDetail } from '../lib/orders/store';
import type { ResearchRow } from '../lib/orders/sources';
import { buildOrderChanges } from '../lib/order-assistant/changes';

const marketId='epic3-denver';
const document=cleanOrderDocument({start:'2027-02-01',end:'2027-02-28',lines:[]},{marketIds:[marketId],workflow:'broadcast'});
const order={id:'order',clientId:'epic3',year:2027,marketIds:[marketId],workflow:'broadcast',document,currentIssue:null} as OrderDetail;
const line=cleanOrderDocument({lines:[{id:'source',media:'TV',marketId,station:'KDEN',program:'News',rate:12000,
  quantity:99,start:'2027-02-01',end:'2027-02-28',source:{kind:'broadcast',id:'source',label:'Current quote',researchRowId:'quote',
    facts:[{label:'Spot rate',value:120,unit:'USD'}]}}]},
  {marketIds:[marketId],workflow:'broadcast'}).lines[0];
const row={id:'quote',marketId,line} as ResearchRow;

test('a verified quote supplies price while a requested quantity replaces any source quantity',()=>{
  const result=buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},[row],()=> 'new-line');
  assert.equal(result.lines[0].id,'new-line');
  assert.equal(result.lines[0].quantity,3);assert.equal(result.lines[0].rate,12000);
  assert.equal(orderTotal(result),36000);
  assert.equal(result.lines[0].source?.researchRowId,'quote');
  assert.equal(order.document.lines.length,0);
  const incomplete=buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote'}],remove:[]},[row],()=> 'new-line');
  assert.equal(incomplete.lines[0].quantity,null);
});

test('forged market/row/line IDs, historical prices and conflicting periods cannot be applied',()=>{
  for(const rows of [[{...row,marketId:'epic3-austin',line:{...line,marketId:'epic3-austin'}}],
    [{...row,line:{...line,source:{...line.source!,kind:'historical' as const}}}],
    [{...row,periods:[{label:'A',line,source:null},{label:'B',line,source:null}]}]]) {
    assert.throws(()=>buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},rows as ResearchRow[],()=> 'new'));
  }
  assert.throws(()=>buildOrderChanges(order,{sheet:'tv',add:[{rowId:'other'}],remove:[]},[row],()=> 'new'));
  assert.throws(()=>buildOrderChanges(order,{sheet:'tv',add:[],remove:['another-order-line']},[row],()=> 'new'));
  assert.throws(()=>buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:-1}],remove:[]},[row],()=> 'new'));
});

test('duplicate placement is rejected while another explicit effective period remains distinct',()=>{
  const existing={...order,document:{...document,lines:[{...line,id:'existing'}]}};
  assert.throws(()=>buildOrderChanges(existing,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},[row],()=> 'new'));
  const different={...row,line:{...line,start:'2027-02-15',end:'2027-02-28'}};
  assert.equal(buildOrderChanges(existing,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},[different],()=> 'new').lines.length,2);
  assert.equal(buildOrderChanges(existing,{sheet:'tv',add:[],remove:['existing']},[],()=> 'new').lines.length,0);
});

test('unknown quote coverage keeps rate incomplete and out-of-flight quotes are rejected',()=>{
  const unknown={...row,line:{...line,start:'',end:''}};
  const result=buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},[unknown],()=> 'new');
  assert.equal(result.lines[0].rate,null);
  assert.throws(()=>buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},
    [{...row,line:{...line,start:'2026-02-01',end:'2026-02-28'}}],()=> 'new'));
});

test('ambiguous price units stay incomplete instead of being assumed USD per spot',()=>{
  for(const facts of [[],[{label:'Spot rate',value:120,unit:'CPM'}],
    [{label:'Spot rate',value:120,unit:'USD'},{label:'Quote rate unit',value:null}]]){
    const ambiguous={...row,line:{...line,source:{...line.source!,facts}}};
    const result=buildOrderChanges(order,{sheet:'tv',add:[{rowId:'quote',quantity:3}],remove:[]},[ambiguous],()=> 'new');
    assert.equal(result.lines[0].rate,null);
  }
});
