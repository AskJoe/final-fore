import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTemplates } from '../lib/research/templates';
import { initial } from '../lib/domain/directory';
import { MARKETS } from '../lib/domain/catalogs';
import { ResearchService, type ResearchRepository } from '../lib/research/service';
import type { TemplateDraft, TemplateVersion } from '../lib/research/types';

class MemoryResearch implements ResearchRepository {
  templates=sourceTemplates(); versions:TemplateVersion[]=[];
  async listTemplates(){return {templates:structuredClone(this.templates),installed:true};}
  async saveTemplate(template:TemplateDraft,expected:number,_directoryRevision:number){
    const current=this.templates.find(t=>t.id===template.id)!;
    if(current.revision!==expected)throw new Error('Template changed. Reload.');
    const saved={...structuredClone(template),revision:expected+1};
    this.templates[this.templates.indexOf(current)]=saved;return saved;
  }
  async publishTemplate(template:TemplateDraft,expected:number,directoryRevision:number){
    const saved=await this.saveTemplate(template,expected,directoryRevision);
    const version={...saved,status:'published',versionId:`v${this.versions.length+1}`,version:this.versions.length+1,markets:saved.markets} as TemplateVersion;
    this.versions.push(structuredClone(version));return version;
  }
}
test('template saves preserve city ownership and reject stale edits',async()=>{
  const repo=new MemoryResearch(),svc=new ResearchService(repo,initial(),0,MARKETS,true);
  const original=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
  const saved=await svc.save({...original,name:'Lincoln radio research'},0);
  assert.equal(saved.revision,1);assert.equal(saved.markets[0].marketId,'epic3-lincoln');
  await assert.rejects(svc.save(original,0),/changed/);
  await assert.rejects(svc.save({...saved,clientId:'forged'},1),/client|identity/i);
});
test('publishing requires all platform links and snapshots survive subsequent template edits',async()=>{
  const repo=new MemoryResearch(),svc=new ResearchService(repo,initial(),0,MARKETS,true);
  repo.templates.find(t=>t.id==='tv-multi')!.markets.find(m=>m.displayName==='Cincinnati, OH')!.marketId=null;
  await assert.rejects(svc.publish('tv-multi',0),/Confirm the platform record/);
  assert.equal(repo.versions.length,0);
  const version=await svc.publish('radio-single-lincoln',0);
  const originalText=version.body;
  const current=(await repo.listTemplates()).templates.find(t=>t.id===version.id)!;
  await svc.save({...current,body:current.body+'\nThank you.'},current.revision);
  assert.equal(repo.versions[0].body,originalText);assert.equal(repo.versions[0].markets.length,1);
});
test('database approval gate prevents writes before any repository mutation',async()=>{
  const repo=new MemoryResearch(),svc=new ResearchService(repo,initial(),0,MARKETS,false);
  await assert.rejects(svc.save(sourceTemplates()[0],0),/database setup/i);
  await assert.rejects(svc.publish('radio-single-lincoln',0),/database setup/i);
  assert.equal(repo.templates[0].revision,0);assert.equal(repo.versions.length,0);
});
test('template edits reject malformed fields and duplicate market rows',async()=>{
  const repo=new MemoryResearch(),svc=new ResearchService(repo,initial(),0,MARKETS,true),t=sourceTemplates()[0];
  await assert.rejects(svc.save({...t,markets:[t.markets[0],t.markets[0]]},0),/once|duplicate/i);
  await assert.rejects(svc.save({...t,body:42} as unknown as TemplateDraft,0),/body/i);
  await assert.rejects(svc.save({...t,defaults:{...t.defaults,markets:'forged'}},0),/merge|field/i);
});
