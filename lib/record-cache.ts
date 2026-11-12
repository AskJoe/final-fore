import type {StoredRecord} from './store';
export type RecordVersion=Pick<StoredRecord,'id'|'kind'|'version'|'updated_at'>;
/** Payloads only. Callers MUST first read current metadata through the user's RLS client. */
export class RecordPayloadCache {
  private entries=new Map<string,{version:RecordVersion;json:string;bytes:number}>();
  private bytes=0;
  constructor(private limit=32*1024*1024){}
  read(current:RecordVersion):StoredRecord|null{
    const entry=this.entries.get(current.id);
    if(!entry||entry.version.kind!==current.kind||entry.version.version!==current.version||entry.version.updated_at!==current.updated_at)return null;
    this.entries.delete(current.id);this.entries.set(current.id,entry);
    // Domain editors mutate payloads; never return the cached object itself.
    return {...current,payload:JSON.parse(entry.json)};
  }
  has(id:string){return this.entries.has(id);}
  hasKind(kind:string){return [...this.entries.values()].some(e=>e.version.kind===kind);}
  remove(id:string){const entry=this.entries.get(id);if(entry){this.bytes-=entry.bytes;this.entries.delete(id);}}
  put(record:StoredRecord){
    this.remove(record.id);
    const json=JSON.stringify(record.payload),bytes=Buffer.byteLength(json);
    if(bytes>this.limit)return;
    while(this.bytes+bytes>this.limit)this.remove(this.entries.keys().next().value!);
    const {id,kind,version,updated_at}=record;
    this.entries.set(id,{version:{id,kind,version,updated_at},json,bytes});this.bytes+=bytes;
  }
}
export const recordPayloadCache=new RecordPayloadCache();
