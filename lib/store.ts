import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict, type Data } from './domain/types';
import {recordPayloadCache, type RecordPayloadCache, type RecordVersion} from './record-cache';
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
  constructor(private db: SupabaseClient,private payloadCache:RecordPayloadCache=recordPayloadCache) {}
  async get(id: string) {
    if(this.payloadCache.has(id)){
      const {data,error}=await this.db.from('ff_records').select('id,kind,version,updated_at').eq('id',id).maybeSingle();
      if(error)storageError(error);
      if(!data)return null;
      const cached=this.payloadCache.read(data as RecordVersion);if(cached)return cached;
    }
    const { data, error } = await this.db.from('ff_records').select('*').eq('id', id).maybeSingle();
    if (error) storageError(error);if(data)this.payloadCache.put(data as StoredRecord);return data as StoredRecord | null;
  }
  async list(kind: string) {
    const records: StoredRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const cachedKind=this.payloadCache.hasKind(kind);
      const query=cachedKind?this.db.from('ff_records').select('id,kind,version,updated_at'):this.db.from('ff_records').select('*');
      const { data, error } = await query.eq('kind', kind).order('id').range(offset, offset + 499);
      if (error) storageError(error);
      if(!cachedKind){for(const record of data as StoredRecord[])this.payloadCache.put(record);records.push(...data as StoredRecord[]);}
      else{
        const page=new Map<string,StoredRecord>(),missing:string[]=[];
        for(const version of data as RecordVersion[]){const hit=this.payloadCache.read(version);if(hit)page.set(version.id,hit);else missing.push(version.id);}
        if(missing.length){
          const fresh=await this.db.from('ff_records').select('*').in('id',missing).order('id');
          if(fresh.error)storageError(fresh.error);
          for(const record of fresh.data as StoredRecord[]){this.payloadCache.put(record);page.set(record.id,record);}
        }
        // Removed/inaccessible rows are never resurrected from a previous cached list.
        for(const version of data as RecordVersion[]){const row=page.get(version.id);if(row)records.push(row);}
      }
      if (data.length < 500) return records;
    }
  }
  async save(id: string, kind: string, payload: Data, version: number, dependency?: StoredRecord) {
    const { error } = await this.db.rpc('ff_save_record', { p_id: id, p_kind: kind, p_payload: payload, p_expected_version: version, p_dependency_id: dependency?.id ?? null, p_dependency_version: dependency?.version ?? null });
    if (error) storageError(error);
    this.payloadCache.remove(id);
  }
}
