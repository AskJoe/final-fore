import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import * as campaigns from '../lib/domain/campaigns';
import * as directory from '../lib/domain/directory';
import {CHANNEL_CATALOG} from '../lib/domain/catalogs';
import {InputError} from '../lib/domain/types';

const script=fs.readFileSync('epic3/web/campaign-calc.js','utf8');
const parties=directory.initial();
/** The calculator exactly as the Campaign page loads it: fed only by API responses. */
function browserCalculator(){
  const page:any={};vm.runInNewContext(script,page);
  const wire=(value:unknown)=>JSON.parse(JSON.stringify(value));
  page.FinalForeCampaign.load(wire(campaigns.catalog().catalog),wire(CHANNEL_CATALOG));
  return (details:unknown)=>page.FinalForeCampaign.preview(wire(details),wire(parties.clients));
}
const server=(details:any)=>JSON.stringify(campaigns.calculate(directory.campaignClient(details,parties)));

test('the committed browser calculator matches its source',async()=>{
  const {bundle}=await import(pathToFileURL(path.join(process.cwd(),'scripts/build-campaign-calc.mjs')).href);
  assert.equal(script,await bundle(),'Run npm run build:campaign-calc and commit epic3/web/campaign-calc.js.');
});

test('browser previews equal the server calculation for saved, blank, funded and broadcast campaigns',()=>{
  const preview=browserCalculator();
  const saved=JSON.parse(fs.readFileSync('.local-migration/campaigns.json','utf8')).map((row:any)=>row.details);
  const blank=campaigns.defaults(),client=parties.clients[0];
  const inputs=[...saved,blank,{...blank,budget:250_000_00,start:'2027-03-01',end:'2027-06-30'},
    ...saved.map((d:any)=>({...d,budget:(d.budget??0)+123_457})),
    {...blank,clientId:client.id,workflow:'broadcast',markets:[]},
    {...blank,clientId:client.id,workflow:'broadcast',budget:90_000_00,markets:[{marketId:client.marketIds[0],region:'',start:'',end:'',override:12_345_67}]}];
  assert.ok(saved.length>0&&client.marketIds.length>0);
  for(const input of inputs){
    const result=preview(input);
    assert.equal(result.ok,true,result.message);
    assert.equal(JSON.stringify(result.result),server(input),input.name);
  }
});

test('browser previews report the same input errors as the server',()=>{
  const preview=browserCalculator(),blank=campaigns.defaults();
  for(const input of [{...blank,name:''},{...blank,year:1999},{...blank,start:'2027-05-01',end:'2027-04-01'},{...blank,clientId:'not-a-client'},{...blank,budget:-1}]){
    let expected='';try{server(input);}catch(error){assert.ok(error instanceof InputError);expected=error.message;}
    assert.ok(expected);
    assert.deepEqual({...preview(input)},{ok:false,message:expected});
  }
});
