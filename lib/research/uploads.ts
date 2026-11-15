import type { SupabaseClient } from '@supabase/supabase-js';
import { InputError } from '../domain/types';
import { StorageError } from '../store';
import { researchStorageError } from './queue-store';
import { authorizePortal, validateUpload, verifyUploadedFile, type PortalRecord, type PortalRepository, MAX_FILE_SIZE } from './portals';
import { isStoredFileAvailable, storedFileStatus } from './file-status';
import { readAll } from './read-all';
import { validateStreamedDocument } from './streamed-document';
import { uploadVerificationGate } from './upload-verification-gate';
import { finishUploadLease, processUploadLease, uploadWorkerEnabled, type UploadLease } from './upload-leases';
import { portalScanner } from './scanner';
export const RESEARCH_BUCKET='research-files';
export type ResearchFile={id:string;conversation_id:string;market_id:string|null;name:string;size:number;sha256:string;content_type:string;object_key:string;state:'uploading'|'checking'|'ready'|'held'|'failed';source:'portal'|'email';uploader?:string;error:string|null;created_at:string;updated_at:string;check_deadline?:string|null;recovery_checked_at?:string|null};
export class SupabasePortalRepository implements PortalRepository {
  constructor(private db:SupabaseClient){}
  async find(hash:string):Promise<PortalRecord|null>{
    const {data:secret,error}=await this.db.from('ff_research_secrets').select('conversation_id').eq('portal_hash',hash).maybeSingle();if(error)researchStorageError(error);if(!secret)return null;
    const {data:c,error:e}=await this.db.from('ff_research_conversations').select('*').eq('id',secret.conversation_id).maybeSingle();if(e)researchStorageError(e);if(!c)return null;
    if(c.mode==='preview'&&(!c.expires_at||Date.parse(c.expires_at)<=Date.now()))return null;
    return {id:c.id,portalState:c.portal_state,mode:c.mode,manifest:c.manifest,recipient:c.recipient};
  }
}
/** Limits the rep can act on must not read as a storage outage. */
function reserveError(error:{code?:string;message:string}):never {
  if(error.code==='PT429')throw new InputError('Too many files at once. Wait a minute, then retry this file.');
  if(error.code==='22023'&&/storage limit/i.test(error.message))throw new InputError('This research collection has reached its storage limit. Contact Final Fore.');
  researchStorageError(error);
}
export class ResearchUploads {
  private portals:SupabasePortalRepository;
  constructor(private db:SupabaseClient){this.portals=new SupabasePortalRepository(db);}
  portal(token:string,write=false){return authorizePortal(token,this.portals,write);}
  async files(portal:PortalRecord){
    // Email attachments are internal records; approved replies deliver them by email. Malware clearance is not portal authorization.
    const {data}=await readAll(this.db.from('ff_research_files').select('*').eq('conversation_id',portal.id).eq('source','portal').order('created_at').order('id'));return data as ResearchFile[];
  }
  async reserve(token:string,input:unknown){
    const portal=await this.portal(token,true),file=validateUpload(input,portal);
    const {data,error}=await this.db.rpc('ff_research_reserve_file',{p_conversation:portal.id,p_market:file.marketId,p_name:file.name,p_size:file.size,p_hash:file.sha256,p_type:file.contentType});if(error)reserveError(error);
    const record=data as ResearchFile;
    if(['ready','checking','held'].includes(record.state))return {file:publicFile(record),grant:null};
    const existing=await this.db.storage.from(RESEARCH_BUCKET).info(record.object_key);
    if(existing.data){
      if(record.state!=='failed')return {file:await this.finalize(token,record.id),grant:null};
      // These stored bytes already failed. Re-checking them would fail again forever; take a fresh copy.
      const removed=await this.db.storage.from(RESEARCH_BUCKET).remove([record.object_key]);
      if(removed.error)return {file:await this.finalize(token,record.id),grant:null};
    }
    else if(existing.error&&!['404','NoSuchKey','not_found'].includes(String(existing.error.statusCode??existing.error.name)))throw new StorageError('Unable to check this upload. Retry shortly.');
    const {data:signed,error:signError}=await this.db.storage.from(RESEARCH_BUCKET).createSignedUploadUrl(record.object_key,{upsert:false});if(signError)throw new StorageError('Unable to start this upload. Retry.');
    return {file:publicFile(record),grant:{token:signed.token,objectKey:record.object_key,bucket:RESEARCH_BUCKET,contentType:record.content_type}};
  }
  async finalize(token:string,id:string){
    const portal=await this.portal(token,true),file=await this.file(portal,id);if(!file)throw new InputError('File does not belong to this upload link.');
    if(['ready','held'].includes(file.state))return publicFile(file);
    const {data,error}=await this.db.storage.from(RESEARCH_BUCKET).info(file.object_key);
    if(error||!data)throw new StorageError('Stored file is not available yet. Retry this file.');
    if(data.size!==file.size)throw new InputError('File size does not match. Choose the file again.');
    if(file.state!=='checking'){
      const {error}=await this.db.rpc('ff_research_finalize_file',{p_conversation:portal.id,p_file:id});
      if(error)researchStorageError(error);
    }
    return this.completeStoredUpload(id);
  }
  private async completeStoredUpload(id:string){
    const lease=await claimPortalUpload(this.db,id,false);
    if(lease==='not-installed'){
      const {error}=await this.db.rpc('ff_research_verify_file',{p_file:id,p_state:'ready',p_error:null});
      if(error)researchStorageError(error);
    }else if(lease?.upload_lease_token){
      await finishUploadLease(this.db,lease,'ready');
    }
    const current=await this.db.from('ff_research_files').select('*').eq('id',id).single();if(current.error)researchStorageError(current.error);
    return publicFile(current.data as ResearchFile);
  }
  private async file(portal:PortalRecord,id:string){
    const {data,error}=await this.db.from('ff_research_files').select('*').eq('conversation_id',portal.id).eq('source','portal').eq('id',id).maybeSingle();if(error)researchStorageError(error);return data as ResearchFile|null;
  }
  /** Called by the existing authenticated portal poll: recover a lost finalize response, no daemon needed. */
  async refresh(portal:PortalRecord,token:string){
    if(portal.portalState==='open'){
      const pending=(await this.files(portal)).filter(f=>f.state==='uploading').sort((a,b)=>
        (a.recovery_checked_at??'').localeCompare(b.recovery_checked_at??''),
      ).slice(0,1);
      for(const file of pending){
        const marked=await this.db.from('ff_research_files').update({recovery_checked_at:new Date().toISOString()}).eq('id',file.id).eq('state',file.state);if(marked.error)researchStorageError(marked.error);
        const info=await this.db.storage.from(RESEARCH_BUCKET).info(file.object_key);
        if(info.data?.size===file.size)await this.finalize(token,file.id);
        else if(Date.now()-Date.parse(file.updated_at)>30*60*1000){const result=await this.db.from('ff_research_files').update({state:'failed',error:'Upload did not finish. Please upload this file again.',updated_at:new Date().toISOString()}).eq('id',file.id).eq('state','uploading');if(result.error)researchStorageError(result.error);}
      }
    }
    return this.files(portal);
  }
  async download(portal:PortalRecord,id:string){
    const file=await this.file(portal,id);if(!file||!isStoredFileAvailable(file))throw new InputError('This file is not ready to download.');
    const {data,error}=await this.db.storage.from(RESEARCH_BUCKET).createSignedUrl(file.object_key,30,{download:file.name});if(error)throw new StorageError('Unable to open the file. Retry.');return data.signedUrl;
  }
}
export function publicFile(file:ResearchFile){return {checkDeadline:file.check_deadline??null,id:file.id,marketId:file.market_id,name:file.name,size:file.size,...storedFileStatus(file),updatedAt:file.updated_at};}
export async function inspectStorageFile(db:SupabaseClient,fileId:string,scan?: (bytes:Buffer)=>Promise<boolean>){
  const {data,error}=await db.from('ff_research_files').select('*').eq('id',fileId).single();if(error)researchStorageError(error);const file=data as ResearchFile;if(file.state!=='checking')return;
  const info=await db.storage.from(RESEARCH_BUCKET).info(file.object_key);if(info.error)throw new StorageError('Storage file is not available for verification.');
  let state:'ready'|'held'|'failed'='failed',reason:string|null=null;
  if(info.data.size!==file.size||info.data.size>MAX_FILE_SIZE)reason='Uploaded file size does not match.';
  else {
    const metadata={name:file.name,size:file.size,sha256:file.sha256,contentType:file.content_type};
    if(scan){
      const result=await db.storage.from(RESEARCH_BUCKET).download(file.object_key);if(result.error)throw new StorageError('Unable to read the uploaded file.');
      try{state=await verifyUploadedFile(Buffer.from(await result.data.arrayBuffer()),metadata,scan);if(state==='held')reason='File did not pass the security check.';}
      catch(e){if(e instanceof InputError||e instanceof TypeError){state='held';reason=(e instanceof InputError?e.message:'The file contents could not be read.')+' Please choose a valid document and upload it again.';}else throw e;}
    }else{
      const signal=AbortSignal.timeout(20000);
      const result=await db.storage.from(RESEARCH_BUCKET).download(file.object_key,{}, {signal}).asStream();if(result.error||!result.data)throw new StorageError('Unable to read the uploaded file.');
      try{await validateStreamedDocument(result.data,metadata,signal);state='ready';}
      catch(e){if(e instanceof InputError){state='held';reason=e.message+' Please choose a valid document and upload it again.';}else throw e;}
    }
  }
  return {state,reason};
}

/** Once the lease migration is installed, portal files can only be finished through a lease,
 * whether or not the separate upload worker is switched on. */
async function claimPortalUpload(db:SupabaseClient,fileId:string,required:boolean):Promise<UploadLease|null|'not-installed'>{
  const {data,error}=await db.rpc('ff_research_claim_portal_upload',{p_file:fileId});
  if(error){
    if(!required&&['PGRST202','42883'].includes(String(error.code)))return 'not-installed';
    researchStorageError(error);
  }
  return data as UploadLease|null;
}
export async function verifyStorageFile(db:SupabaseClient,fileId:string,scan?:(bytes:Buffer)=>Promise<boolean>){
  if(!scan){
    // Portal file. Email attachments always arrive with their scanner.
    let finished=false;
    const started=await uploadVerificationGate.run(fileId,async()=>{
      const file=await claimPortalUpload(db,fileId,uploadWorkerEnabled());
      if(file==='not-installed'){
        const result=await inspectStorageFile(db,fileId,portalScanner());finished=true;if(!result)return;
        const {error}=await db.rpc('ff_research_verify_file',{p_file:fileId,p_state:result.state,p_error:result.reason});if(error)researchStorageError(error);
        return;
      }
      if(!file){finished=!uploadWorkerEnabled();return;}
      finished=true;
      const outcome=await processUploadLease(db,file);
      if(outcome!=='finished')throw new StorageError('Upload verification is pending; the worker will retry.');
    });
    return started&&finished;
  }
  return uploadVerificationGate.run(fileId,async()=>{
    const result=await inspectStorageFile(db,fileId,scan);if(!result)return;
    const {error}=await db.rpc('ff_research_verify_file',{p_file:fileId,p_state:result.state,p_error:result.reason});if(error)researchStorageError(error);
  });
}
