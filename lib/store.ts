import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict, type Data } from './domain/types';
export type StoredRecord = { id: string; kind: string; version: number; payload: Data; updated_at: string };
export interface Store {
  get(id: string): Promise<StoredRecord | null>;
  list(kind: string): Promise<StoredRecord[]>;
  save(id: string, kind: string, payload: Data, version: number, dependency?: StoredRecord): Promise<void>;
}
export class StorageError extends Error {}
function storageError(error: { code?: string; message: string }): never {
  if (error.code === 'PT409' || error.code === '40001' || error.code === '23505') throw new Conflict('This record changed in another window. Reload before saving.');
  throw new StorageError('Unable to access Supabase storage. Confirm the reviewed setup is installed and your account has access.');
}
export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}
  async get(id: string) {
    const { data, error } = await this.db.from('ff_records').select('*').eq('id', id).maybeSingle();
    if (error) storageError(error); return data as StoredRecord | null;
  }
  async list(kind: string) {
    const records: StoredRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.db.from('ff_records').select('*').eq('kind', kind).order('id').range(offset, offset + 499);
      if (error) storageError(error); records.push(...data as StoredRecord[]); if (data.length < 500) return records;
    }
  }
  async save(id: string, kind: string, payload: Data, version: number, dependency?: StoredRecord) {
    const { error } = await this.db.rpc('ff_save_record', { p_id: id, p_kind: kind, p_payload: payload, p_expected_version: version, p_dependency_id: dependency?.id ?? null, p_dependency_version: dependency?.version ?? null });
    if (error) storageError(error);
  }
}
