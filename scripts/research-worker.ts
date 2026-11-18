import { setTimeout as delay } from 'node:timers/promises';
import { StorageError } from '../lib/store';
import { Resend } from 'resend';
import { researchAdmin, researchConfig, researchWritesEnabled } from '../lib/research/config';
import { runResearchWorkerOnce } from '../lib/research/worker';
async function main(){
  if(!researchWritesEnabled()){console.log('Research worker disabled. No database changes or emails.');return;}
  if(!process.argv.includes('--once')&&!process.argv.includes('--watch'))throw new Error('Choose --once or --watch.');
  const key=process.env.RESEND_API_KEY;if(!key)throw new Error('Configure the research Resend key before starting the worker.');
  const db=researchAdmin(),config=researchConfig(),resend=new Resend(key);
  const watch = process.argv.includes('--watch');
  let retryMs = 2_000;
  do {
    try {
      const result = await runResearchWorkerOnce(db, resend, config);
      console.log(JSON.stringify(result));
      retryMs = 2_000;
    } catch (error) {
      if (!watch || !(error instanceof StorageError)) throw error;
      console.error('Research storage unavailable. Retrying in %d seconds.', retryMs / 1000);
      await delay(retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
      continue;
    }
    if (watch) await delay(2_000);
  } while (watch);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Research worker failed.');process.exitCode=1;});
