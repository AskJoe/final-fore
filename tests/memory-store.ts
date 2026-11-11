import { Conflict, type Data } from '../lib/domain/types';
import type { Store, StoredRecord } from '../lib/store';
export class MemoryStore implements Store {
  records = new Map<string, StoredRecord>();
  constructor(records:any[]=[]) {for(const r of records)this.records.set(r.id,{...r,version:1,updated_at:r.updatedAt??'2026-11-10T12:00:00Z'});}
  async get(id:string) {return structuredClone(this.records.get(id)??null);}
  async list(kind:string) {return structuredClone([...this.records.values()].filter(r=>r.kind===kind).sort((a,b)=>a.id.localeCompare(b.id)));}
  async save(id:string,kind:string,payload:Data,version:number,dependency?:StoredRecord) {
    if((this.records.get(id)?.version??0)!==version||dependency&&this.records.get(dependency.id)?.version!==dependency.version)throw new Conflict('Record changed.');
    this.records.set(id,{id,kind,payload:structuredClone(payload),version:version+1,updated_at:new Date().toISOString()});
  }
}
