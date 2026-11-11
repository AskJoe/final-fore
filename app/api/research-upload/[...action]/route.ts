import { researchAdmin, researchWritesEnabled } from '@/lib/research/config';
import { ResearchUploads, publicFile } from '@/lib/research/uploads';
import { failure, json, sameOrigin } from '@/lib/http';
import { InputError } from '@/lib/domain/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{action:string[]}>}){
  if(!sameOrigin(request))return json({error:'Use the upload page to continue.'},403);
  if(!researchWritesEnabled())return json({error:'Research uploads are not enabled yet.'},503);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'Expected JSON.'},415);
  const action=(await context.params).action.join('/');if(!['list','reserve','finalize'].includes(action))return json({error:'Not found.'},404);
  try{
    const reader=request.body?.getReader();if(!reader)throw new InputError('Expected an upload request.');let size=0;const chunks:Uint8Array[]=[];
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>10000){await reader.cancel();return json({error:'Request too large.'},413);}chunks.push(value);}
    const body=JSON.parse(Buffer.concat(chunks).toString());
    if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.token!=='string')throw new InputError('Open a valid upload link.');
    const allowed=action==='list'?['token']:action==='reserve'?['token','file']:['token','fileId'];
    if(Object.keys(body).some(k=>!allowed.includes(k)))throw new InputError('Unknown upload field.');
    const uploads=new ResearchUploads(researchAdmin());
    if(action==='list'){const portal=await uploads.portal(body.token);return json({files:(await uploads.refresh(portal,body.token)).map(publicFile),portalState:portal.portalState});}
    if(action==='reserve')return json(await uploads.reserve(body.token,body.file));
    if(typeof body.fileId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.fileId))throw new InputError('Choose a valid file.');
    return json({file:await uploads.finalize(body.token,body.fileId)});
  }catch(e){return failure(e);}
}
