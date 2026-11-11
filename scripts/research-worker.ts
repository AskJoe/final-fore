import { Resend } from 'resend';
import { researchAdmin, researchConfig, researchWritesEnabled } from '../lib/research/config';
import { runResearchWorkerOnce } from '../lib/research/worker';
async function main(){
  if(!researchWritesEnabled()){console.log('Research worker disabled. No database changes or emails.');return;}
  if(!process.argv.includes('--once')&&!process.argv.includes('--watch'))throw new Error('Choose --once or --watch.');
  const key=process.env.RESEND_API_KEY;if(!key)throw new Error('Configure the research Resend key before starting the worker.');
  const db=researchAdmin(),config=researchConfig(),resend=new Resend(key);
  do{const result=await runResearchWorkerOnce(db,resend,config);console.log(JSON.stringify({deliveries:result.deliveries,jobs:result.jobs,disabled:result.disabled}));if(!process.argv.includes('--watch'))break;await new Promise(resolve=>setTimeout(resolve,2000));}while(true);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Research worker failed.');process.exitCode=1;});
