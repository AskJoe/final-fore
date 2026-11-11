import {uploadStatus} from './file-status';
import { InputError } from '../domain/types';
import type { ResearchManifest } from './requests';
import type { Recipient } from './types';
import type { ResearchFile } from './uploads';

export type ConversationSummary={id:string;mode:'live'|'preview';manifest:ResearchManifest;recipient:Recipient;portal_state:string;created_at:string;updated_at:string;subject:string;unread:boolean;fileCount:number;attention:number;deliveryState:string};
export type IncomingFile=Omit<ResearchFile,'object_key'|'sha256'> & {sender:string;conversationId:string;testUpload?:boolean;markets:ResearchManifest['markets']};
export type IncomingGroup={key:string;clientId:string;campaignKey:string;media:string;marketId:string|null;name:string;files:IncomingFile[]};
export function groupIncomingFiles(rows:{id:string;mode:string;manifest:ResearchManifest;recipient:Recipient;files:ResearchFile[]}[],includeTests=false):IncomingGroup[]{
  const groups=new Map<string,IncomingGroup>();
  for(const c of rows){if(c.mode!=='live'&&!(includeTests&&c.manifest.uploadTestKey))continue;
    for(const file of c.files){
      const key=JSON.stringify([c.manifest.clientId,c.manifest.campaignKey,c.manifest.media,file.market_id]);
      const group=groups.get(key)??{key,clientId:c.manifest.clientId,campaignKey:c.manifest.campaignKey,media:c.manifest.media,marketId:file.market_id,name:c.manifest.markets.find(m=>m.marketId===file.market_id)?.displayName??'Unassigned email attachments',files:[]};
      const {object_key:_object,sha256:_hash,...safe}=file;
      group.files.push({...safe,...uploadStatus(file),testUpload:c.mode==='preview',sender:(file.uploader||c.recipient.name)+' · '+c.recipient.firmName,conversationId:c.id,markets:c.manifest.markets});groups.set(key,group);
    }
  }
  return [...groups.values()].sort((a,b)=>a.marketId===null?-1:b.marketId===null?1:a.name.localeCompare(b.name));
}
export function validateFileAssignment(file:Pick<ResearchFile,'source'|'market_id'>,marketId:unknown,markets:ResearchManifest['markets']):string{
  if(file.source!=='email'||file.market_id!==null)throw new InputError('This file is already assigned.');
  if(typeof marketId!=='string'||!markets.some(m=>m.marketId===marketId))throw new InputError('Choose a market from this conversation’s template.');
  return marketId;
}
export function parseReply(raw:unknown):{conversationId:string;idempotencyKey:string;text:string}{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Enter a reply.');
  const r=raw as Record<string,unknown>;
  if(Object.keys(r).some(k=>!['conversationId','idempotencyKey','text'].includes(k)))throw new InputError('Unknown reply field. Recipients and markets are fixed by the conversation.');
  for(const k of ['conversationId','idempotencyKey'])if(typeof r[k]!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r[k]))throw new InputError('Invalid reply operation.');
  if(typeof r.text!=='string'||!r.text.trim()||r.text.length>50000)throw new InputError('Enter a reply of up to 50,000 characters.');
  return {conversationId:r.conversationId as string,idempotencyKey:r.idempotencyKey as string,text:r.text.trim()};
}
