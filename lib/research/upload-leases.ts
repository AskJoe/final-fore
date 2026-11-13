import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageError } from '../store';
import { inspectStorageFile, RESEARCH_BUCKET, type ResearchFile } from './uploads';
import { researchStorageError } from './queue-store';

export type UploadLease = ResearchFile & { upload_lease_token: string | null; upload_lease_until: string | null; upload_attempts: number };
export const uploadWorkerEnabled = () => process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED === '1';

export async function claimUpload(db: SupabaseClient, fileId: string | null = null): Promise<UploadLease | null> {
  const { data, error } = await db.rpc('ff_research_claim_portal_upload', { p_file: fileId });
  if (error) researchStorageError(error);
  return data as UploadLease | null;
}

export async function processUploadLease(db: SupabaseClient, file: UploadLease): Promise<'finished' | 'retry' | 'stale'> {
  if (!file.upload_lease_token) return 'finished';
  async function finish(state: string, reason: string | null = null) {
    const { data, error } = await db.rpc('ff_research_finish_portal_upload', {
      p_file: file.id, p_lease: file.upload_lease_token, p_state: state, p_error: reason,
    });
    if (error) researchStorageError(error);
    return data === true;
  }
  try {
    if (file.state === 'uploading') {
      const info = await db.storage.from(RESEARCH_BUCKET).info(file.object_key);
      if (info.error) {
        if (['404', 'NoSuchKey', 'not_found'].includes(String(info.error.statusCode ?? info.error.name))) {
          return await finish('missing') ? 'retry' : 'stale';
        }
        throw new StorageError('Storage metadata is temporarily unavailable.');
      }
      if (info.data.size !== file.size) return await finish('failed', 'Uploaded file size does not match. Please retry this file.') ? 'finished' : 'stale';
      const promoted = await db.rpc('ff_research_promote_portal_upload', { p_file: file.id, p_lease: file.upload_lease_token });
      if (promoted.error) researchStorageError(promoted.error);
      if (promoted.data !== true) return 'stale';
    }
    const result = await inspectStorageFile(db, file.id);
    if (!result) return 'stale';
    return await finish(result.state, result.reason) ? 'finished' : 'stale';
  } catch {
    // Lost acknowledgements never get an unfenced write or an unleased fallback.
    // If this acknowledgement also fails, expiry makes the lease recoverable.
    return await finish('retry', 'Verification is temporarily unavailable. It will retry automatically.') ? 'retry' : 'stale';
  }
}

export async function uploadQueueStatus(db: SupabaseClient) {
  const { data, error } = await db.rpc('ff_research_upload_queue_status');
  if (error) researchStorageError(error);
  if (data?.schemaVersion !== 1) throw new StorageError('The reviewed upload lease migration is required.');
  return data as { schemaVersion: number; pending: number; active: number; failed: number; oldestPendingSeconds: number };
}
