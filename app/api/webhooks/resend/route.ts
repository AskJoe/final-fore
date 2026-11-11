import { acceptWebhook, WebhookVerificationError } from '@/lib/research/webhooks';
import { researchAdmin, researchWritesEnabled } from '@/lib/research/config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  const secret=process.env.RESEND_WEBHOOK_SECRET;
  if(!researchWritesEnabled()||!secret)return new Response('Research intake is not enabled.',{status:503});
  const reader=request.body?.getReader();if(!reader)return new Response('Missing body.',{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000){await reader.cancel();return new Response('Too large.',{status:413});}chunks.push(value);}
  try{
    await acceptWebhook(Buffer.concat(chunks).toString('utf8'),Object.fromEntries(request.headers),secret,{async accept(id,type,payload){
      const {data,error}=await researchAdmin().rpc('ff_research_accept_event',{p_id:id,p_type:type,p_payload:payload});
      if(error)throw new Error('Unable to save webhook.');return !!data;
    }});
    return new Response('Accepted.',{status:200});
  }catch(e){return new Response(e instanceof WebhookVerificationError?'Invalid signature.':'Unable to save webhook; retry.',{status:e instanceof WebhookVerificationError?400:503});}
}
