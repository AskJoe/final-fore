import { createClient } from '@supabase/supabase-js';
import { StorageError } from '../store';
import { researchTestOnly,testEmailIdentity } from './send-policy';
export type ResearchConfig={origin:string;replyDomain:string;from:string;sarahEmail:string;secretKey:Buffer;testAccount?:string;directReplies?:boolean};
export function researchConfig():ResearchConfig {
  const origin=process.env.FINAL_FORE_RESEARCH_ORIGIN,replyDomain=process.env.FINAL_FORE_RESEARCH_REPLY_DOMAIN,from=process.env.FINAL_FORE_RESEARCH_FROM,sarahEmail=process.env.FINAL_FORE_RESEARCH_SARAH_EMAIL??'sarah@finalforemedia.com';
  const rawKey=process.env.FINAL_FORE_RESEARCH_SECRET_KEY??'';
  if(!origin||!replyDomain||!from||!/^[a-f0-9]{64}$/i.test(rawKey))throw new StorageError('Complete research email and upload configuration before sending.');
  const url=new URL(origin);
  if(url.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:'))throw new StorageError('Research links require a secure app address.');
  if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(replyDomain)||/[\r\n]/.test(from)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sarahEmail))throw new StorageError('Invalid research email configuration.');
  const testAccount=process.env.FINAL_FORE_RESEARCH_RESEND_TEST_ACCOUNT;
  const temporary=testEmailIdentity(sarahEmail,researchTestOnly(),testAccount);
  const directReplies = !process.env.RESEND_WEBHOOK_SECRET || replyDomain.toLowerCase() === sarahEmail.toLowerCase().split('@')[1];
  return {origin:url.origin,replyDomain:replyDomain.toLowerCase(),from,sarahEmail:sarahEmail.toLowerCase(),secretKey:Buffer.from(rawKey,'hex'),directReplies,...(temporary.allowedRecipient?{testAccount:temporary.allowedRecipient}:{})};
}
export function researchAdmin(){
  if(typeof window!=='undefined')throw new Error('Research service credentials are server-only.');
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new StorageError('Research worker credentials are not configured.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)})}});
}
export const researchWritesEnabled=()=>process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED==='1';
export const researchSendEnabled=()=>researchWritesEnabled()&&process.env.FINAL_FORE_RESEARCH_SEND_ENABLED==='1';
