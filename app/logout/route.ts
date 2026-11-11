import { createClient } from '@/utils/supabase/server';
import { json,sameOrigin,privateHeaders } from '@/lib/http';
export async function POST(request:Request) {
  if(!sameOrigin(request))return json({error:'Use the sign-out button in this app.'},403);
  const supabase=await createClient();const {error}=await supabase.auth.signOut();
  if(error)return json({error:'Unable to sign out. Please try again.'},503);
  return new Response(null,{status:303,headers:{...privateHeaders,Location:'/login'}});
}
