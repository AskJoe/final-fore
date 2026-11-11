import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InputError } from '../domain/types';
import type { PreparedPreview } from './requests';
import type { ResearchConfig } from './config';
import type { MailPayload } from './delivery';
import { emailAddress } from './relay';
import { newToken, hashToken, seal, unseal } from './secrets';
import { researchStorageError, SupabaseRequestRepository } from './queue-store';

export function buildPreviewCopy(original:PreparedPreview,to:string,memberEmail:string,config:ResearchConfig,now=new Date()){
  const recipient=emailAddress(to);
  if(!recipient||![emailAddress(memberEmail),emailAddress(config.sarahEmail)].includes(recipient))throw new InputError('Choose an internal preview recipient: you or Sarah.');
  if(original.email.missing.length)throw new InputError('Complete the template fields before sending a preview.');
  const id=randomUUID(),portalToken=newToken(),externalToken=newToken(),staffToken=newToken();
  const originalSecrets=unseal<{portalToken:string}>(original.secrets,config.secretKey),portalUrl=config.origin+'/research-upload/'+portalToken;
  // Substitute the full original token, including if a previous origin was used. No live portal is exposed in a preview copy.
  const email={subject:'[PREVIEW] '+original.email.subject,text:original.email.text.replaceAll(originalSecrets.portalToken,portalToken),html:original.email.html.replaceAll(originalSecrets.portalToken,portalToken)};
  const payload:MailPayload={from:config.from,to:[recipient],cc:[],subject:email.subject,text:email.text,html:email.html,replyTo:config.sarahEmail,headers:{'X-Final-Fore-Preview':'true','Auto-Submitted':'auto-generated'}};
  return {id,memberId:original.memberId,originalId:original.id,originalHash:original.email.renderHash,versionId:original.versionId,manifest:{...original.manifest,conversationId:id},recipient:original.recipient,email,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString(),portalHash:hashToken(portalToken),externalReplyHash:hashToken(externalToken),staffReplyHash:hashToken(staffToken),secrets:seal({portalToken,externalToken,staffToken,sarahEmail:config.sarahEmail,from:config.from,replyDomain:config.replyDomain},config.secretKey),dispatch:seal(payload,config.secretKey),to:recipient,portalUrl};
}
export async function sendPreviewCopy(raw:unknown,db:SupabaseClient,memberId:string,memberEmail:string,config:ResearchConfig){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Choose a reviewed preview.');
  const input=raw as Record<string,unknown>;
  if(Object.keys(input).some(k=>!['previewId','renderHash','idempotencyKey','recipient'].includes(k))||typeof input.previewId!=='string'||typeof input.renderHash!=='string'||typeof input.recipient!=='string'||typeof input.idempotencyKey!=='string'||!/^[a-f0-9-]{36}$/i.test(input.idempotencyKey))throw new InputError('Invalid preview operation.');
  const [original]=await new SupabaseRequestRepository(db).getPreviews([input.previewId],memberId);
  if(!original||original.email.renderHash!==input.renderHash||Date.parse(original.expiresAt)<=Date.now())throw new InputError('Reopen the email preview before sending it.');
  const copy=buildPreviewCopy(original,input.recipient,memberEmail,config);
  const {data,error}=await db.rpc('ff_research_queue_preview_copy',{p_member:memberId,p_key:input.idempotencyKey,p_copy:copy});if(error)researchStorageError(error);
  // The stored result also handles retries after a network timeout without creating another portal/email.
  return {queued:true,conversationId:data.conversationId,portalUrl:data.portalUrl};
}
