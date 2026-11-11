import type {SupabaseClient} from '@supabase/supabase-js';
import {scanWithClamAv} from './clamav';
import {inspectStorageFile,RESEARCH_BUCKET} from './uploads';
import {researchStorageError} from './queue-store';
/** Upload-only worker. No mail SDK, email config, messages, or delivery queue access. */
export async function runUploadWorkerOnce(db:SupabaseClient,scan=scanWithClamAv){
  // Recover the finalization step if the browser disappeared after sending all bytes.
  const pending=await db.from('ff_research_files').select('id,conversation_id,object_key,size').eq('state','uploading').lt('created_at',new Date(Date.now()-120000).toISOString()).order('recovery_checked_at',{ascending:true,nullsFirst:true}).limit(20);if(pending.error)researchStorageError(pending.error);
  for(const f of pending.data??[]){const marked=await db.from('ff_research_files').update({recovery_checked_at:new Date().toISOString()}).eq('id',f.id);if(marked.error)researchStorageError(marked.error);const info=await db.storage.from(RESEARCH_BUCKET).info(f.object_key);if(info.data?.size===f.size){const r=await db.rpc('ff_research_finalize_file',{p_conversation:f.conversation_id,p_file:f.id});if(r.error&&r.error.code!=='42501')researchStorageError(r.error);}}
  let count=0;
  for(let i=0;i<10;i++){
    const {data:job,error}=await db.rpc('ff_research_claim_upload_job');if(error)researchStorageError(error);if(!job)break;
    let state='retry',reason:string|null='Security scanner is temporarily unavailable.';
    try{const result=await inspectStorageFile(db,job.payload.fileId,scan);if(result){state=result.state;reason=result.reason;}else{state='failed';reason='File is no longer awaiting verification.';}}
    catch{/* Bounded retry, followed by an explicit failed file. No raw infrastructure details sent to reps. */}
    const done=await db.rpc('ff_research_finish_upload_job',{p_id:job.id,p_lease:job.lease_token,p_state:state,p_error:reason});if(done.error)researchStorageError(done.error);count++;
  }
  return count;
}
