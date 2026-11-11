import test from 'node:test';
import assert from 'node:assert/strict';
import { readAll } from '../lib/research/read-all';
test('research lists do not silently stop at the provider row cap',async()=>{
  const input=Array.from({length:1201},(_,id)=>({id})),ranges:number[][]=[];
  const result=await readAll({range:async(from,to)=>{ranges.push([from,to]);return {data:input.slice(from,to+1),error:null};}});
  assert.equal(result.data.length,1201);assert.equal(result.data.at(-1)?.id,1200);assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
});
