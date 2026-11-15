import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageError } from '../store';
import { RESEARCH_BUCKET, type ResearchFile } from './uploads';
import { researchStorageError } from './queue-store';

export type UploadLease = ResearchFile & { upload_lease_token: string | null; upload_lease_until: string | null; upload_attempts: number };
export const uploadWorkerEnabled = () => process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED === '1';

export async function claimUpload(db: SupabaseClient, fileId: string | null = null): Promise<UploadLease | null> {
  const { data, error } = await db.rpc('ff_research_claim_portal_upload', { p_file: fileId });
  if (error) researchStorageError(error);
  return data as UploadLease | null;
}

export async function finishUploadLease(db: SupabaseClient, file: UploadLease, state: string, reason: string | null = null) {
  const { data, error } = await db.rpc('ff_research_finish_portal_upload', {
    p_file: file.id, p_lease: file.upload_lease_token, p_state: state, p_error: reason,
  });
  if (error) researchStorageError(error);
  return data === true;
}

export async function processUploadLease(db: SupabaseClient, file: UploadLease): Promise<'finished' | 'retry' | 'stale'> {
  if (!file.upload_lease_token) return 'finished';
  try {
    const info = await db.storage.from(RESEARCH_BUCKET).info(file.object_key);
    if (info.error) {
      const missing = ['404', 'NoSuchKey', 'not_found'].includes(String(info.error.statusCode ?? info.error.name));
      if (file.state === 'uploading' && missing) {
        return await finishUploadLease(db, file, 'missing') ? 'retry' : 'stale';
      }
      throw new StorageError('Storage metadata is temporarily unavailable.');
    }
    if (info.data.size !== file.size) {
      const saved = await finishUploadLease(db, file, 'failed', 'Uploaded file size does not match. Please retry this file.');
      return saved ? 'finished' : 'stale';
    }
    if (file.state === 'uploading') {
      const promoted = await db.rpc('ff_research_promote_portal_upload', { p_file: file.id, p_lease: file.upload_lease_token });
      if (promoted.error) researchStorageError(promoted.error);
      if (promoted.data !== true) return 'stale';
    }
    return await finishUploadLease(db, file, 'ready') ? 'finished' : 'stale';
  } catch {
    // Lost acknowledgements never get an unfenced write or an unleased fallback.
    // If this acknowledgement also fails, expiry makes the lease recoverable.
    return await finishUploadLease(db, file, 'retry', 'Storage is temporarily unavailable. The app will retry.') ? 'retry' : 'stale';
  }
}

export async function uploadQueueStatus(db: SupabaseClient) {
  const { data, error } = await db.rpc('ff_research_upload_queue_status');
  if (error) researchStorageError(error);
  if (data?.schemaVersion !== 1) throw new StorageError('The reviewed upload lease migration is required.');
  return data as { schemaVersion: number; pending: number; active: number; failed: number; oldestPendingSeconds: number };
}
