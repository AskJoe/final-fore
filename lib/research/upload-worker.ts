import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimUpload, processUploadLease } from './upload-leases';
import { uploadVerificationGate } from './upload-verification-gate';

/** Portal-only queue. It cannot claim email jobs and has no mail or scanner dependency. */
export async function runUploadWorkerOnce(db: SupabaseClient) {
  const result = { claimed: 0, finished: 0, retry: 0, stale: 0 };
  const lanes = await Promise.allSettled(Array.from({ length: 2 }, async () => {
    await uploadVerificationGate.run('upload-worker:' + randomUUID(), async () => {
      const file = await claimUpload(db);
      if (!file) return;
      result.claimed++;
      result[await processUploadLease(db, file)]++;
    });
  }));
  const failed = lanes.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return result;
}
