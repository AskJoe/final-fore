import { createHash } from 'node:crypto';
import { formatEmailBody } from './email-format';
import { inlineTemplateSchedule } from './template-schedule';
import { InputError } from '../domain/types';
import type { PreviewInput, Recipient, RenderedEmail, TemplateDraft } from './types';


function parseInput(raw:unknown,allowEmptyDeadline=false): PreviewInput {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new InputError('Choose a template and rep.');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['templateId','repId','deadline'].includes(k))) throw new InputError('Unknown request field. Markets and content belong to the template.');
  for(const key of ['templateId','repId']) if(typeof v[key]!=='string'||!v[key]||v[key].length>100) throw new InputError(`Choose a valid ${key==='repId'?'rep':'template'}.`);
  if(allowEmptyDeadline&&(v.deadline===undefined||v.deadline===''))return {...v,deadline:''} as PreviewInput;
  if(typeof v.deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.deadline)||!Number.isFinite(Date.parse(v.deadline))||new Date(v.deadline).toISOString().slice(0,10)!==v.deadline) throw new InputError('Choose a valid deadline date.');
  return v as PreviewInput;
}
export function parsePreviewInput(raw:unknown){return parseInput(raw);}
export function parseTemplatePreviewInput(raw:unknown){return parseInput(raw,true);}

export function renderEmail(draft:TemplateDraft, recipient:Recipient, mergeValues:Record<string,string>, portalUrl:string): RenderedEmail {
  const template = inlineTemplateSchedule(draft);
  let url:URL;
  try {url=new URL(portalUrl);} catch {throw new InputError('Use a valid upload URL.');}
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))) throw new InputError('Use a secure upload URL.');
  const names=template.markets.map(m=>m.displayName);
  const values:Record<string,string>={...template.defaults,...mergeValues,first_name:recipient.name.split(' ')[0],rep_name:recipient.name,firm:recipient.firmName,media:template.media==='broadcast-radio'?'Radio':'TV',markets:names.join('\n'),markets_inline:names.join('; '),market_summary:names.length===1?names[0]:`${names.length} markets`,upload_url:portalUrl};
  const missing=new Set<string>();
  const merge=(s:string)=>s.replace(/\{\{([a-z_]+)\}\}/g,(token,key:string)=>{
    // Own properties only: {{constructor}} must read as a missing field, not Object.prototype.
    const value=Object.hasOwn(values,key)&&typeof values[key]==='string'?values[key]:undefined;
    if(!value?.trim()&&key!=='sender_title'){missing.add(key);return token;}
    return value??'';
  });
  const subject=merge(template.subject);
  const {text,html}=formatEmailBody(template,merge,portalUrl);
  if(/[\r\n]/.test(subject)) throw new InputError('The subject must be a single line.');

  const renderHash=createHash('sha256').update(JSON.stringify({templateId:template.id,revision:template.revision,subject,text,html,to:recipient.to,cc:recipient.cc})).digest('hex');
  return {subject,text,html,renderHash,missing:[...missing]};
}
