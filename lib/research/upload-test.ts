import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {StorageError} from '../store';
import {InputError} from '../domain/types';
import {newToken,hashToken,seal,unseal} from './secrets';
import {researchStorageError} from './queue-store';
import {ResearchUploads,publicFile} from './uploads';
import type {TemplateDraft,Recipient} from './types';

function key(){const raw=process.env.FINAL_FORE_RESEARCH_SECRET_KEY??'';if(!/^[a-f0-9]{64}$/i.test(raw))throw new StorageError('Test upload storage needs its encryption key configured.');return Buffer.from(raw,'hex');}
export function uploadTestKey(template:TemplateDraft,recipient:Recipient,deadline:string){return createHash('sha256').update(JSON.stringify({template,recipient,deadline})).digest('hex');}
export async function findUploadTest(db:SupabaseClient,memberId:string,previewKey:string){
  const {data,error}=await db.from('ff_research_conversations').select('id').eq('created_by',memberId).eq('mode','preview').eq('manifest->>uploadTestKey',previewKey).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1);if(error)researchStorageError(error);
  if(!data?.[0])return null;
  const {data:secret,error:e}=await db.from('ff_research_secrets').select('ciphertext').eq('conversation_id',data[0].id).single();if(e)researchStorageError(e);
  return uploadTestResult(db,unseal<{portalToken:string}>(secret!.ciphertext,key()).portalToken);
}
async function uploadTestResult(db:SupabaseClient,token:string){const uploads=new ResearchUploads(db),portal=await uploads.portal(token);return {token,conversationId:portal.id,initialState:portal.portalState,initialFiles:(await uploads.files(portal)).map(publicFile)};}
export async function startUploadTest(db:SupabaseClient,memberId:string,template:TemplateDraft,recipient:Recipient,deadline:string){
  const encryptionKey=key(),previewKey=uploadTestKey(template,recipient,deadline),id=randomUUID(),portalToken=newToken();
  const markets=template.markets.filter((m):m is {marketId:string;displayName:string}=>!!m.marketId);
  if(!markets.length)throw new InputError('Confirm a platform market on this template before testing uploads.');
  const manifest={conversationId:id,templateVersionId:null,templateName:template.name,clientId:template.clientId,campaignKey:template.campaignKey,media:template.media,firmName:recipient.firmName,deadline,markets,displayMarkets:structuredClone(template.markets),uploadTestKey:previewKey};
  const {data,error}=await db.rpc('ff_research_start_upload_test',{p_member:memberId,p_copy:{id,manifest,recipient,portalHash:hashToken(portalToken),externalReplyHash:hashToken(newToken()),staffReplyHash:hashToken(newToken()),secrets:seal({portalToken},encryptionKey)}});if(error)researchStorageError(error);
  // Atomic reuse returns the winning token on retries or simultaneous first uploads.
  return uploadTestResult(db,unseal<{portalToken:string}>(data.ciphertext,encryptionKey).portalToken);
}
