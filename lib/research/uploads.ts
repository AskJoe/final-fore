import type { SupabaseClient } from '@supabase/supabase-js';
import { InputError } from '../domain/types';
import { StorageError } from '../store';
import { researchStorageError } from './queue-store';
import { authorizePortal, validateUpload, validateUploadedDocument, verifyUploadedFile, type PortalRecord, type PortalRepository, MAX_FILE_SIZE } from './portals';
import { uploadStatus } from './file-status';
import { readAll } from './read-all';
export const RESEARCH_BUCKET='research-files';
export type ResearchFile={id:string;conversation_id:string;market_id:string|null;name:string;size:number;sha256:string;content_type:string;object_key:string;state:'uploading'|'checking'|'ready'|'held'|'failed';source:'portal'|'email';uploader?:string;error:string|null;created_at:string;updated_at:string;check_deadline?:string|null};
export class SupabasePortalRepository implements PortalRepository {
  constructor(private db:SupabaseClient){}
  async find(hash:string):Promise<PortalRecord|null>{
    const {data:secret,error}=await this.db.from('ff_research_secrets').select('conversation_id').eq('portal_hash',hash).maybeSingle();if(error)researchStorageError(error);if(!secret)return null;
    const {data:c,error:e}=await this.db.from('ff_research_conversations').select('*').eq('id',secret.conversation_id).maybeSingle();if(e)researchStorageError(e);if(!c)return null;
    if(c.mode==='preview'&&(!c.expires_at||Date.parse(c.expires_at)<=Date.now()))return null;
    return {id:c.id,portalState:c.portal_state,mode:c.mode,manifest:c.manifest,recipient:c.recipient};
  }
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
    const {data,error}=await this.db.rpc('ff_research_reserve_file',{p_conversation:portal.id,p_market:file.marketId,p_name:file.name,p_size:file.size,p_hash:file.sha256,p_type:file.contentType});if(error)researchStorageError(error);
    const record=data as ResearchFile;
    if(['ready','checking','held'].includes(record.state))return {file:publicFile(record),grant:null};
    const existing=await this.db.storage.from(RESEARCH_BUCKET).info(record.object_key);
    if(existing.data){return {file:await this.finalize(token,record.id),grant:null};}
    if(existing.error&&!['404','NoSuchKey','not_found'].includes(String(existing.error.statusCode??existing.error.name)))throw new StorageError('Unable to check this upload. Retry shortly.');
    const {data:signed,error:signError}=await this.db.storage.from(RESEARCH_BUCKET).createSignedUploadUrl(record.object_key,{upsert:false});if(signError)throw new StorageError('Unable to start this upload. Retry.');
    return {file:publicFile(record),grant:{token:signed.token,objectKey:record.object_key,bucket:RESEARCH_BUCKET,contentType:record.content_type}};
  }
  async finalize(token:string,id:string){
    const portal=await this.portal(token,true),file=(await this.files(portal)).find(f=>f.id===id);if(!file)throw new InputError('File does not belong to this upload link.');
    if(['ready','held'].includes(file.state))return publicFile(file);
    if(file.state==='checking')return this.complete(file);
    const {data,error}=await this.db.storage.from(RESEARCH_BUCKET).info(file.object_key);
    if(error||!data)throw new StorageError('File upload is not complete. Retry this file.');
    if(data.size!==file.size)throw new InputError('File size does not match. Choose the file again.');
    const {error:e}=await this.db.rpc('ff_research_finalize_file',{p_conversation:portal.id,p_file:id});if(e)researchStorageError(e);return this.complete({...file,state:'checking'});
  }
  private async complete(file:ResearchFile){
    let state:ResearchFile['state']='failed',error:string|null=null;
    try{
      const result=await inspectStorageFile(this.db,file.id);
      if(result){state=result.state;error=result.reason;}
      else return publicFile((await this.db.from('ff_research_files').select('*').eq('id',file.id).single()).data as ResearchFile);
    }catch{error='Could not finish verifying the upload. Please upload this file again.';}
    const result=await this.db.rpc('ff_research_verify_file',{p_file:file.id,p_state:state,p_error:error});if(result.error)researchStorageError(result.error);
    const current=await this.db.from('ff_research_files').select('*').eq('id',file.id).single();if(current.error)researchStorageError(current.error);
    return publicFile(current.data as ResearchFile);
  }
  /** Called by the existing authenticated portal poll: recover a lost finalize response, no daemon needed. */
  async refresh(portal:PortalRecord,token:string){
    if(portal.portalState==='open'){
      const pending=(await this.files(portal)).filter(f=>f.state==='checking'||f.state==='uploading').slice(0,2);
      for(const file of pending){
        if(file.state==='checking'){await this.complete(file);continue;}
        const info=await this.db.storage.from(RESEARCH_BUCKET).info(file.object_key);
        if(info.data?.size===file.size)await this.finalize(token,file.id);
        else if(Date.now()-Date.parse(file.updated_at)>30*60*1000){const result=await this.db.from('ff_research_files').update({state:'failed',error:'Upload did not finish. Please upload this file again.',updated_at:new Date().toISOString()}).eq('id',file.id).eq('state','uploading');if(result.error)researchStorageError(result.error);}
      }
    }
    return this.files(portal);
  }
  async download(portal:PortalRecord,id:string){
    const file=(await this.files(portal)).find(f=>f.id===id&&f.state==='ready');if(!file)throw new InputError('This file is not ready to download.');
    const {data,error}=await this.db.storage.from(RESEARCH_BUCKET).createSignedUrl(file.object_key,30,{download:file.name});if(error)throw new StorageError('Unable to open the file. Retry.');return data.signedUrl;
  }
}
export function publicFile(file:ResearchFile){return {checkDeadline:file.check_deadline??null,id:file.id,marketId:file.market_id,name:file.name,size:file.size,...uploadStatus(file),updatedAt:file.updated_at};}
export async function inspectStorageFile(db:SupabaseClient,fileId:string,scan?: (bytes:Buffer)=>Promise<boolean>){
  const {data,error}=await db.from('ff_research_files').select('*').eq('id',fileId).single();if(error)researchStorageError(error);const file=data as ResearchFile;if(file.state!=='checking')return;
  const info=await db.storage.from(RESEARCH_BUCKET).info(file.object_key);if(info.error)throw new StorageError('Storage file is not available for verification.');
  let state:'ready'|'held'|'failed'='failed',reason:string|null=null;
  if(info.data.size!==file.size||info.data.size>MAX_FILE_SIZE)reason='Uploaded file size does not match.';
  else {
    const result=await db.storage.from(RESEARCH_BUCKET).download(file.object_key);if(result.error)throw new StorageError('Unable to read the uploaded file.');
    try{const bytes=Buffer.from(await result.data.arrayBuffer()),metadata={name:file.name,size:file.size,sha256:file.sha256,contentType:file.content_type};if(scan){state=await verifyUploadedFile(bytes,metadata,scan);if(state==='held')reason='File did not pass the security check.';}else{await validateUploadedDocument(bytes,metadata);state='ready';}}
    catch(e){if(e instanceof InputError||e instanceof TypeError){state='held';reason=(e instanceof InputError?e.message:'The file contents could not be read.')+' Please choose a valid document and upload it again.';}else throw e;}
  }
  return {state,reason};
}

export async function verifyStorageFile(db:SupabaseClient,fileId:string,scan?:(bytes:Buffer)=>Promise<boolean>){
  const result=await inspectStorageFile(db,fileId,scan);if(!result)return;
  const {error}=await db.rpc('ff_research_verify_file',{p_file:fileId,p_state:result.state,p_error:result.reason});if(error)researchStorageError(error);
}
