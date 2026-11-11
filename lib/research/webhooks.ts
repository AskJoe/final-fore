import { Resend } from 'resend';
export class WebhookVerificationError extends Error {}
export interface EventRepository {accept(id:string,type:string,payload:unknown):Promise<boolean>;}
const verifier=new Resend('re_local_signature_verification_only'); // verify() performs no network request.
export async function acceptWebhook(raw:string,headers:Record<string,string>,secret:string,repo:EventRepository):Promise<boolean>{
  let event;
  try{event=verifier.webhooks.verify({payload:raw,headers:{id:headers['svix-id'],timestamp:headers['svix-timestamp'],signature:headers['svix-signature']},webhookSecret:secret});}
  catch{throw new WebhookVerificationError('Invalid webhook signature.');}
  if(!event||typeof event.type!=='string'||!event.type.startsWith('email.'))return false;
  return repo.accept(headers['svix-id'],event.type,event);
}
