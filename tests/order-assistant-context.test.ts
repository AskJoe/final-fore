import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMarketContext, cleanResearchView, cleanStarUpdates } from '../lib/order-assistant/types';

const context={id:'context',userId:'buyer',orderId:'order',clientId:'epic3',year:2027,marketId:'epic3-denver',
  workflow:'broadcast' as const,expiresAt:'2027-01-01T00:00:00Z',detached:false};
const order={id:'order',clientId:'epic3',year:2027,marketIds:['epic3-denver'],workflow:'broadcast' as const};

test('context is bound to user, exact order, client, year, workflow and one market',()=>{
  assert.doesNotThrow(()=>assertMarketContext(context,'buyer',order,new Date('2026-11-24')));
  for(const changed of [{...order,id:'other'},{...order,clientId:'other'},{...order,year:2026},
    {...order,marketIds:['epic3-austin']},{...order,marketIds:['epic3-denver','epic3-austin']},
    {...order,workflow:'digital' as const}]) assert.throws(()=>assertMarketContext(context,'buyer',changed,new Date('2026-11-24')));
  assert.throws(()=>assertMarketContext(context,'someone-else',order,new Date('2026-11-24')));
  assert.throws(()=>assertMarketContext(context,'buyer',order,new Date('2027-01-02')));
  assert.throws(()=>assertMarketContext({...context,detached:true},'buyer',order,new Date('2026-11-24'),true));
});

test('view cannot inject another market, client or order and rejects unbounded or invalid filters',()=>{
  assert.deepEqual(cleanResearchView({sheet:'radio',q:'weather',page:2}),{sheet:'radio',q:'weather',page:2});
  for(const raw of [{sheet:'radio',marketId:'other'},{sheet:'radio',clientId:'other'},
    {sheet:'radio',url:'https://other.example'},{sheet:'radio',page:-1},{sheet:'unknown'},
    {sheet:'radio',q:'x'.repeat(201)},{sheet:'tv',exactCpm:-1}]) assert.throws(()=>cleanResearchView(raw));
});

test('stars are explicit desired states with bounded IDs, never toggles or arbitrary writes',()=>{
  assert.deepEqual(cleanStarUpdates([{rowId:'quote-1',starred:true}]),[{rowId:'quote-1',starred:true}]);
  for(const raw of [[{rowId:'quote',starred:'yes'}],[{rowId:'',starred:true}],
    [{rowId:'quote',starred:true,marketId:'other'}],[{rowId:'quote',starred:true},{rowId:'quote',starred:false}]])
    assert.throws(()=>cleanStarUpdates(raw));
});
