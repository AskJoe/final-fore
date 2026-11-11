import { randomUUID } from 'node:crypto';
import { InputError } from '../domain/types';
import type { Directory } from '../domain/directory';
import type { TemplateVersion, Recipient, RenderedEmail, Media } from './types';
import type { ResearchConfig } from './config';
import type { MailPayload } from './delivery';
import { parsePreviewInput, renderEmail } from './render';
import { recipientGroups, type AssignmentContext } from './assignments';
import { newToken, hashToken, seal } from './secrets';

export type ResearchManifest={displayMarkets?:{marketId:string|null;displayName:string}[];uploadTestKey?:string;conversationId:string;templateVersionId:string;templateName:string;clientId:string;campaignKey:string;media:Media;firmName:string;deadline:string;markets:{marketId:string;displayName:string}[]};
export type PreparedPreview={id:string;memberId:string;createdAt:string;expiresAt:string;directoryRevision:number;assignmentRevision?:number;versionId:string;templateId:string;templateRevision:number;manifest:ResearchManifest;recipient:Recipient;email:RenderedEmail;portalHash:string;externalReplyHash:string;staffReplyHash:string;secrets:string;dispatch:{vendor:string;gmail:string}};
export type SendInput={idempotencyKey:string;previews:{previewId:string;renderHash:string}[]};
export type QueueResult={requestId:string;conversationIds:string[]};
export interface RequestRepository {
  savePreview(preview:PreparedPreview):Promise<void>;
  getPreviews(ids:string[],memberId:string):Promise<PreparedPreview[]>;
  /** Must recheck ownership, expiry, directory/template revisions and unique operation key atomically. */
  queueBatch(memberId:string,key:string,previews:PreparedPreview[]):Promise<QueueResult>;
}
export async function prepareRequest(raw:unknown,version:TemplateVersion,directory:Directory,directoryRevision:number,memberId:string,repo:RequestRepository,config:ResearchConfig,now=new Date(),assignments?:AssignmentContext):Promise<PreparedPreview>{
  const input=parsePreviewInput(raw);
  if(input.templateId!==version.id||version.status!=='published'||!version.markets.length||version.markets.some(m=>!m.marketId))throw new InputError('Publish this template with confirmed market links first.');
  const recipient=recipientGroups([input],directory,[version],assignments)[0],id=randomUUID(),portalToken=newToken(),externalToken=newToken(),staffToken=newToken();
  const portalUrl=config.origin+'/research-upload/'+portalToken,email=renderEmail(version,recipient,{deadline:input.deadline},portalUrl);
  const externalAddress=`reply-${externalToken}@${config.replyDomain}`,staffAddress=`staff-${staffToken}@${config.replyDomain}`;
  const vendor:MailPayload={from:config.from,to:[recipient.to],cc:recipient.cc,subject:email.subject,text:email.text,html:email.html,replyTo:externalAddress};
  const gmail:MailPayload={...vendor,to:[config.sarahEmail],cc:[],replyTo:staffAddress};
  const preview:PreparedPreview={id,memberId,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+24*3600000).toISOString(),directoryRevision,assignmentRevision:assignments?.overrides.find(a=>a.repId===input.repId&&a.templateId===input.templateId)?.revision??0,versionId:version.versionId,templateId:version.id,templateRevision:version.revision,
    manifest:{conversationId:id,templateVersionId:version.versionId,templateName:version.name,clientId:version.clientId,campaignKey:version.campaignKey,media:version.media,firmName:recipient.firmName,deadline:input.deadline,markets:structuredClone(version.markets)},recipient,email,portalHash:hashToken(portalToken),externalReplyHash:hashToken(externalToken),staffReplyHash:hashToken(staffToken),secrets:seal({portalToken,externalToken,staffToken,sarahEmail:config.sarahEmail,from:config.from,replyDomain:config.replyDomain},config.secretKey),dispatch:{vendor:seal(vendor,config.secretKey),gmail:seal(gmail,config.secretKey)}};
  await repo.savePreview(preview);return preview;
}
export function parseSendInput(raw:unknown):SendInput {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Choose reviewed email previews.');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['idempotencyKey','previews'].includes(k)))throw new InputError('Unknown request field. Markets belong to the template.');
  if(typeof v.idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/i.test(v.idempotencyKey))throw new InputError('Invalid send operation.');
  if(!Array.isArray(v.previews)||!v.previews.length||v.previews.length>100)throw new InputError('Choose 1–100 reviewed previews.');
  for(const p of v.previews)if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['previewId','renderHash'].includes(k))||typeof p.previewId!=='string'||p.previewId.length>100||typeof p.renderHash!=='string'||!/^[a-f0-9]{64}$/.test(p.renderHash))throw new InputError('Invalid or changed preview.');
  if(new Set(v.previews.map(p=>p.previewId)).size!==v.previews.length)throw new InputError('Choose each preview only once.');
  return v as SendInput;
}
export async function queuePrepared(raw:unknown,memberId:string,repo:RequestRepository,enabled:boolean,now=new Date()):Promise<QueueResult>{
  if(!enabled)throw new InputError('Email sending is disabled. No email was sent.');
  const input=parseSendInput(raw),rows=await repo.getPreviews(input.previews.map(p=>p.previewId),memberId);
  if(rows.length!==input.previews.length)throw new InputError('Reopen the email previews before sending.');
  const groups=new Set<string>();
  for(const p of rows){
    if(p.memberId!==memberId||p.email.renderHash!==input.previews.find(x=>x.previewId===p.id)?.renderHash)throw new InputError('The preview changed. Review it again.');
    if(!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now.getTime())throw new InputError('The preview expired. Review it again.');
    if(p.email.missing.length)throw new InputError('Complete the template fields before sending: '+p.email.missing.join(', '));
    const group=JSON.stringify([p.versionId,p.recipient.firmId,[p.recipient.to,...p.recipient.cc].map(e=>e.toLowerCase()).sort()]);
    if(groups.has(group))throw new InputError('This recipient group is selected twice for the same template.');groups.add(group);
  }
  return repo.queueBatch(memberId,input.idempotencyKey,rows);
}
