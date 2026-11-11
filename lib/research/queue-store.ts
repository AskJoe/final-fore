import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict } from '../domain/types';
import { StorageError } from '../store';
import type { PreparedPreview, RequestRepository, QueueResult } from './requests';
import type { Delivery, DeliveryRepository, DeliveryState, MailPayload } from './delivery';
import { unseal } from './secrets';
export function researchStorageError(error:{code?:string;message:string}):never {
  if(error.code==='PT409'||error.code==='23505')throw new Conflict('Research data changed. Refresh and review before continuing.');
  throw new StorageError('Research storage is unavailable. Check the approved setup or retry.');
}
export class SupabaseRequestRepository implements RequestRepository {
  constructor(private db:SupabaseClient){}
  async savePreview(p:PreparedPreview){const {error}=await this.db.rpc('ff_research_prepare_preview',{p_preview:p});if(error)researchStorageError(error);}
  async getPreviews(ids:string[],memberId:string){const {data,error}=await this.db.from('ff_research_previews').select('payload').in('id',ids).eq('member_id',memberId);if(error)researchStorageError(error);return (data??[]).map(r=>r.payload as PreparedPreview);}
  async queueBatch(memberId:string,key:string,rows:PreparedPreview[]):Promise<QueueResult>{
    const {data,error}=await this.db.rpc('ff_research_queue_batch',{p_member:memberId,p_key:key,p_refs:rows.map(p=>({previewId:p.id,renderHash:p.email.renderHash}))});if(error)researchStorageError(error);return data as QueueResult;
  }
}
export class SupabaseDeliveryRepository implements DeliveryRepository {
  private leases=new Map<string,string>();
  constructor(private db:SupabaseClient,private key:Buffer){}
  async claim(id:string):Promise<Delivery|null>{
    const {data:r,error}=await this.db.rpc('ff_research_claim_delivery',{p_id:id});if(error)researchStorageError(error);if(!r)return null;
    this.leases.set(id,r.lease_token);
    return {id:r.id,state:r.state,idempotencyKey:r.idempotency_key,firstAttemptAt:r.first_attempt_at,providerId:r.provider_id,payload:unseal<MailPayload>(r.payload_ciphertext,this.key)};
  }
  async recordAttempt(id:string,_at:string){const {error}=await this.db.rpc('ff_research_delivery_attempt',{p_id:id,p_lease:this.leases.get(id)});if(error)researchStorageError(error);}
  async finish(id:string,state:DeliveryState,changes:Partial<Delivery>={}){const {error}=await this.db.rpc('ff_research_finish_delivery',{p_id:id,p_lease:this.leases.get(id),p_state:state,p_provider_id:changes.providerId??null,p_error:changes.error??null});if(error)researchStorageError(error);this.leases.delete(id);}
}
