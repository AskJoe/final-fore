import { researchAdmin, researchWritesEnabled } from '@/lib/research/config';
import { ResearchUploads } from '@/lib/research/uploads';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{token:string;fileId:string}>}){
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
  if(!researchWritesEnabled())return new Response('Uploads are not enabled.',{status:503,headers});
  try{const {token,fileId}=await params,uploads=new ResearchUploads(researchAdmin()),portal=await uploads.portal(token),url=await uploads.download(portal,fileId);return new Response(null,{status:303,headers:{...headers,Location:url}});}
  catch{return new Response('This file is not available.',{status:404,headers});}
}
