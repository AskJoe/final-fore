import seed from '../../data/research-assignment-seed.json';
import { createHash } from 'node:crypto';
import type { Directory } from '../domain/directory';
import { InputError, type Data } from '../domain/types';
import type { Eligibility, Recipient, Selection, TemplateDraft } from './types';

type SourceAssignment={repId:string;firmId:string;email:string;scope:string|null;status:string;marketIds:string[];cc:string[];reason:string;sourceHash:string;sourceInactive:boolean};
const assignments:SourceAssignment[]=seed;
export function sourceCc(rep:Data){return assignments.find(s=>s.repId===rep.id&&s.firmId===rep.firmId&&s.email.toLowerCase()===rep.email.toLowerCase())?.cc??[];}
export type AssignmentOverride={repId:string;templateId:string;firmId:string;email:string;directoryRevision:number;templateSignature:string;confirmed:boolean;cc:string[];revision:number};
export type AssignmentContext={overrides:AssignmentOverride[];directoryRevision:number};
function templateSignature(t:TemplateDraft){return createHash('sha256').update(JSON.stringify([t.clientId,t.media,t.scope,t.markets])).digest('hex');}
export function makeAssignment(rep:Data,template:TemplateDraft,directoryRevision:number,confirmed:boolean,cc:string[]):AssignmentOverride{
  if(!isResearchContact(rep)||!rep.coverage.some((c:Data)=>c.mediaType===template.media))throw new InputError('Choose a compatible active rep.');
  if(typeof confirmed!=='boolean'||!Array.isArray(cc)||cc.some(e=>typeof e!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))throw new InputError('Choose valid coverage and CC contacts.');
  return {repId:rep.id,templateId:template.id,firmId:rep.firmId,email:rep.email.toLowerCase(),directoryRevision,templateSignature:templateSignature(template),confirmed,cc:[...new Set(cc.map(e=>e.toLowerCase()))],revision:0};
}

export function isResearchContact(rep:Data):boolean {
  return !!rep.active&&!assignments.some(s=>s.repId===rep.id&&s.sourceInactive);
}

export function eligibleTemplates(rep: Data, directory: Directory, templates: TemplateDraft[], context?:AssignmentContext): Eligibility[] {
  const firm=directory.firms.find(f=>f.id===rep.firmId&&f.active);
  if(!isResearchContact(rep)||!firm||!rep.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rep.email)) return [];
  const evidence=assignments.find(s=>s.repId===rep.id&&s.firmId===rep.firmId&&s.email.toLowerCase()===rep.email.toLowerCase());
  if(evidence?.status==='excluded') return [];
  return templates.filter(t=>rep.coverage.some((c:Data)=>c.mediaType===t.media)).map(t=>{
    const override=context?.overrides.find(a=>a.repId===rep.id&&a.templateId===t.id);
    if(override){const current=override.directoryRevision===context!.directoryRevision&&override.firmId===rep.firmId&&override.email===rep.email.toLowerCase()&&override.templateSignature===templateSignature(t);return {templateId:t.id,confirmed:current&&override.confirmed,reason:current?'Coverage not selected.':'Coverage changed. Confirm again.'};}
    const confirmed=evidence?.status==='confirmed'&&evidence.scope===t.scope&&(t.scope==='multi'||t.markets.length===1&&!!t.markets[0].marketId&&evidence.marketIds.includes(t.markets[0].marketId));
    return {templateId:t.id,confirmed:!!confirmed,reason:confirmed?'':evidence?.status==='needs-confirmation'?evidence.reason:'Confirm this rep’s coverage for this template.'};
  });
}

export function recipientGroups(selections: Selection[], directory: Directory, templates: TemplateDraft[], context?:AssignmentContext): Recipient[] {
  const groups=new Map<string,Recipient>();
  for(const selection of selections) {
    const rep=directory.reps.find(r=>r.id===selection.repId);
    if(!rep||!eligibleTemplates(rep,directory,templates,context).some(e=>e.templateId===selection.templateId&&e.confirmed)) throw new InputError('Confirm a compatible template for this rep.');
    const evidence=assignments.find(s=>s.repId===rep.id&&s.firmId===rep.firmId&&s.email.toLowerCase()===rep.email.toLowerCase())!;
    const override=context?.overrides.find(a=>a.repId===rep.id&&a.templateId===selection.templateId);
    const cc=(override?.cc??evidence?.cc??[]).filter(email=>directory.reps.some(r=>isResearchContact(r)&&r.firmId===rep.firmId&&r.email.toLowerCase()===email.toLowerCase()&&r.id!==rep.id));
    const addresses=[...new Set([rep.email,...cc].map(email=>email.toLowerCase()))].sort();
    const key=JSON.stringify([rep.firmId,selection.templateId,addresses]);
    if(!groups.has(key)) groups.set(key,{...selection,firmId:rep.firmId,firmName:directory.firms.find(f=>f.id===rep.firmId)!.name,name:rep.name,to:rep.email,cc});
  }
  return [...groups.values()];
}
