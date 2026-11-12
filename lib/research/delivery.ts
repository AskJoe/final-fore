import { Resend, type CreateEmailOptions } from 'resend';
import { providerPayload, researchTestOnly } from './send-policy';

export type DeliveryState='queued'|'sending'|'retry'|'uncertain'|'sent'|'delivered'|'bounced'|'failed'|'needs-review';
export type MailPayload={from:string;to:string[];cc?:string[];subject:string;text:string;html?:string;replyTo:string;headers?:Record<string,string>;attachments?:{filename:string;content:Buffer|string}[];testRecipients?:string[]};
export type Delivery={id:string;state:DeliveryState;idempotencyKey:string;firstAttemptAt:string|null;payload:MailPayload;providerId:string|null;error?:string};
export interface DeliveryRepository {
  /** Atomically acquire a bounded lease. Expired leases must be recoverable. */
  claim(id:string):Promise<Delivery|null>;
  /** Persist before network I/O without releasing the lease. */
  recordAttempt(id:string,at:string):Promise<void>;
  finish(id:string,state:DeliveryState,changes?:Partial<Delivery>):Promise<void>;
}
export interface MailTransport {send(payload:MailPayload,idempotencyKey:string):Promise<{id:string}|{error:string;status:number|null}>;}

export async function processDelivery(id:string,repository:DeliveryRepository,transport:MailTransport,enabled:boolean,now=new Date()):Promise<DeliveryState|'disabled'|'busy'>{
  if(!enabled)return 'disabled';
  const delivery=await repository.claim(id);if(!delivery)return 'busy';
  if(['sent','delivered','bounced','failed','needs-review'].includes(delivery.state)){
    await repository.finish(id,delivery.state);return delivery.state;
  }
  // Application history outlives the provider's 24-hour deduplication window.
  if(delivery.firstAttemptAt&&(!Number.isFinite(Date.parse(delivery.firstAttemptAt))||now.getTime()-Date.parse(delivery.firstAttemptAt)>=24*60*60*1000)){
    await repository.finish(id,'needs-review',{error:'Confirm the prior delivery before sending again.'});return 'needs-review';
  }
  await repository.recordAttempt(id,now.toISOString());
  let result:Awaited<ReturnType<MailTransport['send']>>;
  try{result=await transport.send(delivery.payload,delivery.idempotencyKey);}
  catch{
    await repository.finish(id,'uncertain',{error:'The provider outcome is unknown. Retry with the same delivery key.'});return 'uncertain';
  }
  if('id' in result){await repository.finish(id,'sent',{providerId:result.id,error:undefined});return 'sent';}
  const state:DeliveryState=result.status===null?'uncertain':result.status===429||result.status>=500?'retry':'failed';
  await repository.finish(id,state,{error:result.error});return state;
}

/** Call only in the server worker. Runtime flag is checked again at the network boundary. */
export function resendTransport(client:Resend,enabled:()=>boolean):MailTransport {
  return {async send(payload,key){
    if(!enabled())throw new Error('Real email sending is disabled.');
    let mail:Omit<MailPayload,'testRecipients'>;
    try{mail=providerPayload(payload,researchTestOnly(),process.env.FINAL_FORE_RESEARCH_SARAH_EMAIL??'sarah@finalforemedia.com',process.env.FINAL_FORE_RESEARCH_RESEND_TEST_ACCOUNT);}
    catch(error){return {error:error instanceof Error?error.message:'Email blocked by test mode.',status:403};}
    const {data,error}=await client.emails.send(mail as CreateEmailOptions,{idempotencyKey:key,signal:AbortSignal.timeout(60000)});
    return error?{error:error.message,status:error.statusCode}: {id:data.id};
  }};
}
