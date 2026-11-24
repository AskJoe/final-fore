import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLine,projectResearchPage } from '../lib/order-assistant/projection';
import type { OrderLine } from '../lib/orders/store';
test('model evidence omits workbook-wide choices and other-market original file metadata',()=>{
  const line={marketId:'epic3-denver',source:{id:'denver-source',kind:'broadcast',label:'Denver quote',facts:[
    {label:'Spot rate',value:50,unit:'USD'},
    {label:'Original file 1',value:JSON.stringify({id:'denver-source',marketId:'epic3-denver',name:'Denver.pdf'})},
    {label:'Original file 2',value:JSON.stringify({id:'austin-source',marketId:'epic3-austin',name:'Austin-private.pdf'})},
  ]}} as OrderLine;
  const native={rows:[{id:'quote',marketId:'epic3-denver',market:'Denver',program:'News',firm:'Rep firm',rep:'Rep',line,cells:[50],source:null}],
    columns:[{label:'Spot rate'}],filterOptions:{market:['Denver','Austin-private']},total:1,page:1,pageCount:1};
  const model=projectResearchPage(native);
  assert.equal(JSON.stringify(model).includes('Austin-private'),false);
  assert.equal('filterOptions' in model,false);
  assert.equal(projectLine(line).source?.facts?.some(fact=>fact.unit==='USD'),true);
  assert.equal(projectLine(line).source?.facts?.length,2);
});
