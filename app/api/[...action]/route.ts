import { readForMember, requireMember } from '@/lib/access';
import { createClient } from '@/utils/supabase/server';
import { Service } from '@/lib/service';
import { SupabaseStore } from '@/lib/store';
import { failure, json, sameOrigin } from '@/lib/http';
import { object } from '@/lib/domain/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string[] }> };
const reads = new Set(['planning','directory','table','markets','order','campaign/catalog','campaign/history','campaigns','campaign','campaign-order/options','campaign-order']);
const writes = new Set(['planning/cell','planning/formula','directory/entity','cell','formula','variable','order','order/preview','campaign','campaign/preview','campaign-order','campaign-order/preview']);
export async function GET(request: Request, context: Context) {
  const path = (await context.params).action.join('/');
  if (path === 'health') return json({ok:true,app:'Final Fore',backend:'Supabase',storageVerified:false});
  if (!reads.has(path)) return json({error:'Not found.'},404);
  try {
    // Every read here goes through ff_records, whose RLS policy admits members only.
    const supabase = await createClient();
    return json(await readForMember(supabase,() => new Service(new SupabaseStore(supabase)).get(path,new URL(request.url).searchParams)));
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const path = (await context.params).action.join('/');
  if (!writes.has(path)) return json({error:'Not found.'},404);
  if (!sameOrigin(request)) return json({error:'Use this app to save changes.'},403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({error:'Expected JSON.'},415);
  try {
    const {supabase} = await requireMember();
    const limit = path.startsWith('campaign') || path.startsWith('order') || path.startsWith('directory') ? 150000 : 10000;
    if (Number(request.headers.get('content-length')) > limit) return json({error:'Request is too large.'},413);
    const reader=request.body?.getReader(); if (!reader) return json({error:'Expected a request body.'},400);
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();return json({error:'Request is too large.'},413);}chunks.push(value);}
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!object(payload)) return json({error:'Expected a JSON object.'},400);
    return json(await new Service(new SupabaseStore(supabase)).post(path,payload));
  } catch (error) { return failure(error); }
}
