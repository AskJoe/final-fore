import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import { runUploadWorkerOnce } from '../lib/research/upload-worker';
import { uploadQueueStatus } from '../lib/research/upload-leases';

async function main() {
  // Local credentials are supplied explicitly with --env-file; Render uses its environment.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED !== '1' || process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED !== '1') throw new Error('Upload worker and research writes must be explicitly enabled.');
  if (!url || !key) throw new Error('Upload storage credentials are required.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) throw new Error('Use secure Supabase storage or a local test backend.');
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
  });
  console.log(JSON.stringify({ event: 'upload-worker-started', queue: await uploadQueueStatus(db) }));
  let stopping = false, nextReport = Date.now() + 60000;
  const stop = () => { if (!stopping) console.log(JSON.stringify({ event: 'upload-worker-stopping' })); stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  do {
    try {
      const result = await runUploadWorkerOnce(db);
      if (result.claimed) console.log(JSON.stringify({ event: 'upload-worker-batch', ...result }));
      if (Date.now() >= nextReport) { console.log(JSON.stringify({ event: 'upload-worker-queue', queue: await uploadQueueStatus(db) })); nextReport = Date.now() + 60000; }
      if (process.argv.includes('--once') || stopping) break;
      await delay(result.claimed ? 100 : 2000);
    } catch (error) {
      if (process.argv.includes('--once')) throw error;
      console.error('Upload worker unavailable; stored jobs remain recoverable.');
      if (!stopping) await delay(5000);
    }
  } while (!stopping);
  process.off('SIGTERM', stop); process.off('SIGINT', stop);
  console.log(JSON.stringify({ event: 'upload-worker-stopped', graceful: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Upload worker startup failed.'); process.exitCode = 1; });
