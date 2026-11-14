/** Finish existing trusted portal uploads without sending mail or removing files. */
import assert from 'node:assert/strict';
import {researchAdmin} from '../lib/research/config';
import {verifyStorageFile} from '../lib/research/uploads';
process.loadEnvFile('.env.local');
async function main(){
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');assert.equal(process.env.FINAL_FORE_RESEARCH_SEND_ENABLED,'0');
 const db=researchAdmin(),before=await db.from('ff_research_deliveries').select('id').order('id');if(before.error)throw before.error;
 const pending=await db.from('ff_research_files').select('id,name').eq('source','portal').eq('state','checking');if(pending.error)throw pending.error;
 for(const file of pending.data??[]){
  // Works before and after the upload-lease migration; a transient failure stays queued for retry.
  try{await verifyStorageFile(db,file.id);}catch(e){console.log(JSON.stringify({file:file.name,pending:e instanceof Error?e.message:'Verification did not finish.'}));continue;}
  const stored=await db.from('ff_research_files').select('state,error').eq('id',file.id).single();if(stored.error)throw stored.error;
  console.log(JSON.stringify({file:file.name,...stored.data}));
 }
 const after=await db.from('ff_research_deliveries').select('id').order('id');if(after.error)throw after.error;assert.deepEqual(after.data,before.data);
 console.log('Finished pending portal uploads; no files deleted, no emails queued.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
