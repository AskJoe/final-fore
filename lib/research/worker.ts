import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { researchConfig, researchSendEnabled, researchWritesEnabled, type ResearchConfig } from './config';
import { processDelivery, resendTransport } from './delivery';
import { SupabaseDeliveryRepository, researchStorageError } from './queue-store';
import { ingestReceivedEmail } from './inbound';
import { verifyStorageFile, RESEARCH_BUCKET } from './uploads';

export async function scanResearchFile(bytes:Buffer):Promise<boolean>{
  const url=process.env.FINAL_FORE_RESEARCH_SCANNER_URL,key=process.env.FINAL_FORE_RESEARCH_SCANNER_KEY;
  if(!url||!key)throw new Error('Research file scanner is not configured.');
  const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.protocol==='http:'))throw new Error('File scanner requires HTTPS.');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+key},body:new Uint8Array(bytes),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('File scanner is temporarily unavailable.');
  const result=await response.json();if(typeof result.clean!=='boolean'||result.sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('File scanner result could not be verified.');return result.clean;
}

export async function runResearchWorkerOnce(db:SupabaseClient,resend:Resend,config?:ResearchConfig,scan=scanResearchFile):Promise<{deliveries:number;jobs:number;disabled:boolean}>{
  if(!researchWritesEnabled())return {deliveries:0,jobs:0,disabled:true};
  config??=researchConfig();
  let deliveries=0,jobs=0;
  if(researchSendEnabled()){
    const pending=await db.from('ff_research_deliveries').select('id').in('state',['queued','retry','uncertain','sending']).lte('available_at',new Date().toISOString()).order('available_at').limit(10);if(pending.error)researchStorageError(pending.error);
    const repository=new SupabaseDeliveryRepository(db,config.secretKey),transport=resendTransport(resend,researchSendEnabled);
    for(const row of pending.data??[]){await processDelivery(row.id,repository,transport,researchSendEnabled());deliveries++;}
  }
  // Recover storage-complete uploads even if the rep closed the browser before finalization.
  const interrupted=await db.from('ff_research_files').select('id,conversation_id,object_key,size').eq('state','uploading').lt('created_at',new Date(Date.now()-120000).toISOString()).order('recovery_checked_at',{ascending:true,nullsFirst:true}).order('id').limit(20);if(interrupted.error)researchStorageError(interrupted.error);
  for(const file of interrupted.data??[]){
    // Rotate every inspected reservation, including absent objects and closed collections.
    const checked=await db.from('ff_research_files').update({recovery_checked_at:new Date().toISOString()}).eq('id',file.id);if(checked.error)researchStorageError(checked.error);
    const info=await db.storage.from(RESEARCH_BUCKET).info(file.object_key);if(info.data?.size===file.size){const result=await db.rpc('ff_research_finalize_file',{p_conversation:file.conversation_id,p_file:file.id});if(result.error&&result.error.code!=='42501')researchStorageError(result.error);}
  }
  for(let i=0;i<10;i++){
    const {data:job,error}=await db.rpc('ff_research_claim_job');if(error)researchStorageError(error);if(!job)break;
    let failure:string|null=null,leaseLost=false;
    const heartbeat=setInterval(()=>{void db.rpc('ff_research_renew_job',{p_id:job.id,p_lease:job.lease_token}).then(({error})=>{if(error)leaseLost=true;});},30000);
    try{
      if(job.kind==='verify-file'){
        const file=await db.from('ff_research_files').select('source').eq('id',job.payload.fileId).single();if(file.error)researchStorageError(file.error);
        if(file.data.source==='portal'){
          try{await verifyStorageFile(db,job.payload.fileId);}
          catch{const failed=await db.rpc('ff_research_verify_file',{p_file:job.payload.fileId,p_state:'failed',p_error:'Could not finish verifying the upload. Please upload this file again.'});if(failed.error)researchStorageError(failed.error);}
        }else await verifyStorageFile(db,job.payload.fileId,scan);
      }
      else if(job.kind==='receive'){
        if(typeof job.payload?.data?.email_id!=='string')throw new Error('Received event has no email ID.');
        await ingestReceivedEmail(db,resend,job.payload.data.email_id,config,scan);
      }else if(job.kind==='event'){
        const data=job.payload?.data;
        if(typeof data?.email_id!=='string')throw new Error('Delivery event has no email ID.');
        const applied=await db.rpc('ff_research_apply_delivery_event',{p_provider:data.email_id,p_type:job.payload.type,p_rfc_id:data.message_id??null});if(applied.error)throw new Error('Delivery event could not be linked yet.');
      }else throw new Error('Unsupported research job.');
    }catch(e){failure=e instanceof Error?e.message:'Research job failed.';}
    finally{clearInterval(heartbeat);}
    if(leaseLost)throw new Error('Research worker lease changed; this worker did not acknowledge the job.');
    const completed=await db.rpc('ff_research_finish_job',{p_id:job.id,p_lease:job.lease_token,p_error:failure});if(completed.error)researchStorageError(completed.error);jobs++;
  }
  return {deliveries,jobs,disabled:false};
}
