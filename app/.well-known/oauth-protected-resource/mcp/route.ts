import { protectedResourceMetadata } from '@/lib/order-assistant/auth';
export async function GET(){
  return Response.json(protectedResourceMetadata(),{headers:{'Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*'}});
}
