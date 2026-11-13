import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../lib/domain/directory';
import { sourceTemplates } from '../lib/research/templates';
import { eligibleTemplates, recipientGroups, makeAssignment } from '../lib/research/assignments';
import { ResearchService } from '../lib/research/service';
import { MARKETS } from '../lib/domain/catalogs';

test('manual confirmation applies only to the reviewed rep, template coverage and directory revision',()=>{
  const directory=initial(),templates=sourceTemplates(),template=templates.find(t=>t.id==='tv-multi')!;
  const tvRep=directory.reps.find(r=>r.name==='Lisa Matukaitis')!;
  const rep={...tvRep,id:'new-tv-rep',name:'New TV rep',email:'new-tv-rep@example.test'};
  directory.reps.push(rep);
  assert.ok(rep);assert.equal(eligibleTemplates(rep,directory,[template])[0].confirmed,false);
  const assignment=makeAssignment(rep,template,7,true,[]);
  const context={overrides:[assignment],directoryRevision:7};
  assert.equal(eligibleTemplates(rep,directory,[template],context)[0].confirmed,true);
  assert.equal(eligibleTemplates(rep,directory,[template],{...context,directoryRevision:8})[0].confirmed,false);
  assert.equal(eligibleTemplates(rep,directory,[{...template,markets:template.markets.slice(1)}],context)[0].confirmed,false);
  assert.equal(eligibleTemplates({...rep,email:'changed@example.com'},directory,[template],context)[0].confirmed,false);
  assert.deepEqual(recipientGroups([{repId:rep.id,templateId:template.id}],directory,templates,context)[0].cc,[]);
});
test('a template copy preserves full source content while saving its own city selection',async()=>{
  const source=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
  const stored:any[]=[];
  const repo={listTemplates:async()=>({templates:[source,...stored],installed:true}),saveTemplate:async(t:any)=>{stored.push({...t,revision:1});return stored.at(-1);},publishTemplate:async()=>{throw new Error('not called');}};
  const service=new ResearchService(repo,initial(),0,MARKETS,true);
  const copy=await service.copy(source.id,0);
  assert.notEqual(copy.id,source.id);assert.equal(copy.body,source.body);assert.equal(copy.markets.length,1);assert.equal(copy.status,'draft');
  copy.markets=[{marketId:'epic3-madison',displayName:'Madison, WI'}];assert.equal(source.markets[0].marketId,'epic3-lincoln');
  await assert.rejects(service.save(undefined as any,0),/template/i);
});
