import { AccessError, requireMember } from '@/lib/access';
import { available, legacyAsset } from '@/lib/legacy-pages';
import { failure, privateHeaders, json } from '@/lib/http';
import { loginPath } from '@/lib/login-errors';
import { Service } from '@/lib/service';
import { SupabaseStore } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request:Request,context:{params:Promise<{path:string[]}>}) {
  const name=(await context.params).path.join('/');
  if (!available.has(name) && name!=='reporting-data.json') return json({error:'Not found.'},404);
  try {
    // Even assets are protected: the legacy order script includes a contact/station catalog.
    const {supabase}=await requireMember();
    if(name==='reporting-data.json')return json(await new Service(new SupabaseStore(supabase)).report());
    const {content,type}=await legacyAsset(name);
    return new Response(content,{headers:{...privateHeaders,'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'"}});
  } catch(error) {
    if(error instanceof AccessError && name.endsWith('.html')) {
      const location=loginPath(error);
      return new Response(null,{status:303,headers:{...privateHeaders,Location:location}});
    }
    return failure(error);
  }
}
