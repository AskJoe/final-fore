import {createClient} from '@supabase/supabase-js';
import {runUploadWorkerOnce} from '../lib/research/upload-worker';
process.loadEnvFile('.env.local');
async function main(){
 if(process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED!=='1')throw new Error('Upload storage is disabled.');
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw new Error('This worker launcher is local-only.');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)})}});
 do{try{const count=await runUploadWorkerOnce(db);if(count)console.log(new Date().toISOString()+' verified '+count+' upload jobs; no email operations.');}catch(e){console.error(new Date().toISOString()+' Upload worker unavailable: '+(e instanceof Error?e.message:'Unknown error'));}if(process.argv.includes('--once'))break;await new Promise(r=>setTimeout(r,2000));}while(true);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
