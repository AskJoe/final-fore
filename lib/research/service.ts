import { Conflict, InputError, type Data } from '../domain/types';
import type { Directory } from '../domain/directory';
import { validateTemplate } from './templates';
import { inlineTemplateSchedule } from './template-schedule';
import type { TemplateDraft, TemplateVersion } from './types';
import { randomUUID } from 'node:crypto';

export interface ResearchRepository {
  listTemplates():Promise<{templates:TemplateDraft[];installed:boolean}>;
  saveTemplate(template:TemplateDraft,expectedRevision:number,directoryRevision:number):Promise<TemplateDraft>;
  publishTemplate(template:TemplateDraft,expectedRevision:number,directoryRevision:number):Promise<TemplateVersion>;
}
export class ResearchService {
  constructor(private repo:ResearchRepository,private directory:Directory,private directoryRevision:number,private catalog:Record<string,Data>,private writesEnabled:boolean){}
  private guard(){if(!this.writesEnabled)throw new InputError('Saving is available after the approved database setup.');}
  async save(input:TemplateDraft,expectedRevision:number):Promise<TemplateDraft>{
    this.guard();
    if(!input||typeof input!=='object'||Array.isArray(input))throw new InputError('Choose a valid template.');
    const current=(await this.repo.listTemplates()).templates.find(t=>t.id===input.id);
    if(!current)throw new InputError('Choose an existing template.');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==current.revision)throw new Conflict('Template changed. Reload before saving.');
    for(const key of ['clientId','campaignKey','media','scope','sourceHash'] as const)if(input[key]!==current[key])throw new InputError('Template identity and client cannot be changed here.');
    for(const [key,max] of [['name',200],['subject',1000],['body',100000]] as const)if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max)throw new InputError(`Enter a valid ${key}.`);
    if(!Array.isArray(input.markets)||input.markets.length>200||input.markets.some(m=>!m||typeof m.displayName!=='string'||m.displayName.length>200||m.marketId!==null&&typeof m.marketId!=='string'))throw new InputError('Choose valid markets on the template.');
    if(!input.defaults||typeof input.defaults!=='object'||Array.isArray(input.defaults)||Object.entries(input.defaults).some(([k,v])=>!Object.hasOwn(current.defaults,k)||typeof v!=='string'||v.length>1000))throw new InputError('Invalid template merge field.');
    const clean=inlineTemplateSchedule({...current,name:input.name.trim(),subject:input.subject,body:input.body,markets:structuredClone(input.markets),defaults:{...current.defaults,...input.defaults},status:'draft'});
    const issues=validateTemplate(clean,this.directory,this.catalog).filter(i=>i.code!=='market-link');
    const seenNames=new Set<string>();
    for(const m of clean.markets){if(seenNames.has(m.displayName))throw new InputError('Choose each market only once.');seenNames.add(m.displayName);}
    if(issues.length)throw new InputError(issues[0].message);
    return this.repo.saveTemplate(clean,expectedRevision,this.directoryRevision);
  }
  async copy(id:string,expectedRevision:number):Promise<TemplateDraft>{
    this.guard();const original=(await this.repo.listTemplates()).templates.find(t=>t.id===id);
    if(!original)throw new InputError('Choose a template to copy.');
    if(original.revision!==expectedRevision)throw new Conflict('Template changed. Reload before copying.');
    const {versionId:_versionId,version:_version,...draft}=original as TemplateDraft&Partial<TemplateVersion>;
    return this.repo.saveTemplate({...structuredClone(draft),id:'research-'+randomUUID(),name:original.name+' (copy)',revision:0,status:'draft'},0,this.directoryRevision);
  }
  async publish(id:string,expectedRevision:number):Promise<TemplateVersion>{
    this.guard();const t=(await this.repo.listTemplates()).templates.find(t=>t.id===id);
    if(!t)throw new InputError('Choose a template.');
    if(t.revision!==expectedRevision)throw new Conflict('Template changed. Reload before publishing.');
    const issues=validateTemplate(t,this.directory,this.catalog);
    if(issues.length)throw new InputError(issues.map(i=>i.message).join(' '));
    return this.repo.publishTemplate(t,expectedRevision,this.directoryRevision);
  }
}
