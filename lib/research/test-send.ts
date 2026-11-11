import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InputError } from '../domain/types';
import type { TemplateDraft,Recipient } from './types';
import type { ResearchConfig } from './config';
import type { MailPayload } from './delivery';
import { renderEmail } from './render';
import { testEmailAddresses } from './send-policy';
import { startUploadTest } from './upload-test';
import { seal } from './secrets';
import { researchStorageError } from './queue-store';

export function buildTestEmail(template:TemplateDraft,recipient:Recipient,deadline:string,portalUrl:string,addresses:string[],config:ResearchConfig):MailPayload{
  const email=renderEmail(template,recipient,{deadline},portalUrl);
  if(email.missing.length)throw new InputError('Complete the template fields before sending: '+email.missing.join(', '));
  return {from:config.sarahEmail,replyTo:config.sarahEmail,to:[...addresses],cc:[],subject:'[TEST] '+email.subject,text:email.text,html:email.html,testRecipients:[...addresses]};
}

export async function queueTestEmail(db:SupabaseClient,memberId:string,template:TemplateDraft,recipient:Recipient,deadline:string,raw:Record<string,unknown>,reviewUrl:string,config:ResearchConfig){
  if(typeof raw.idempotencyKey!=='string'||! /^[a-f0-9-]{36}$/i.test(raw.idempotencyKey))throw new InputError('Invalid test send operation.');
  const addresses=testEmailAddresses(raw.testRecipients),review=renderEmail(template,recipient,{deadline},reviewUrl);
  if(raw.renderHash!==review.renderHash)throw new InputError('The template or rep changed. Preview the email again.');
  // Validate fields before creating any collection. The emailed link uses the same saved template markets.
  buildTestEmail(template,recipient,deadline,reviewUrl,addresses,config);
  const collection=await startUploadTest(db,memberId,template,recipient,deadline),portalUrl=config.origin+'/research-upload/'+collection.token;
  const payload=buildTestEmail(template,recipient,deadline,portalUrl,addresses,config);
  const fingerprint=createHash('sha256').update(JSON.stringify({renderHash:review.renderHash,addresses,identity:config.sarahEmail,conversationId:collection.conversationId})).digest('hex');
  const {data,error}=await db.rpc('ff_research_queue_test_email',{p_member:memberId,p_key:raw.idempotencyKey,p_conversation:collection.conversationId,p_fingerprint:fingerprint,p_copy:{subject:payload.subject,text:payload.text,html:payload.html,sender:payload.from,recipients:addresses,dispatch:seal(payload,config.secretKey)}});
  if(error)researchStorageError(error);
  return {queued:true,deliveryId:data.deliveryId,portalUrl,recipients:addresses};
}
