import { createClient } from '@supabase/supabase-js';
import { AccessError } from '../access';
import { check } from '../domain/types';
import { supabaseConfig } from '../../utils/supabase/config';
import { orderRuntime,ordersAdmin,ordersSecret } from '../orders/runtime';

const mcpRole='ff_market_order_oauth';
export function mcpResource(){return new URL('/mcp',process.env.FINAL_FORE_APP_ORIGIN??'https://my.finalforemedia.com').toString();}
export function validateMcpClaims(claims:Record<string,unknown>,
  expected:{issuer:string;audience:string;clientId:string;userId:string;role?:string},now=Math.floor(Date.now()/1000)){
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  check(claims.iss===expected.issuer&&audiences.includes(expected.audience)&&claims.client_id===expected.clientId&&
    claims.sub===expected.userId&&claims.role===(expected.role??'authenticated')&&typeof claims.exp==='number'&&claims.exp>now,
  'Connect the approved Final Fore OAuth client to access this market.');
}
export async function authenticateMcp(request:Request){
  const match=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/);
  if(!match)throw new AccessError('Connect Final Fore to use this market.',401);
  const clientId=process.env.FINAL_FORE_CHATGPT_OAUTH_CLIENT_ID;
  if(!clientId)throw new AccessError('The Final Fore OAuth client is not configured.',503);
  const {url,key}=supabaseConfig(),token=match[1];
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const [verification,userResult]=await Promise.all([supabase.auth.getClaims(token),supabase.auth.getUser(token)]);
  if(verification.error||!verification.data||userResult.error||!userResult.data.user)throw new AccessError('Reconnect Final Fore to continue.',401);
  try{validateMcpClaims(verification.data.claims,{
    issuer:url.replace(/\/$/,'')+'/auth/v1',audience:mcpResource(),clientId,userId:userResult.data.user.id,role:mcpRole,
  });}catch{throw new AccessError('Connect the approved Final Fore OAuth client.',401);}
  // The OAuth role has no database access. Only verified members reach the market-scoped services.
  const user=userResult.data.user,admin=ordersAdmin();
  const membership=await admin.from('ff_members').select('user_id').eq('user_id',user.id).maybeSingle();
  if(membership.error)throw new AccessError('Final Fore membership could not be checked.',503);
  if(!membership.data)throw new AccessError('Your account has not been granted access to Final Fore.',403);
  return orderRuntime({supabase:admin,user,researchApiKey:ordersSecret()},admin);
}
export function protectedResourceMetadata(){
  const {url}=supabaseConfig();
  return {resource:mcpResource(),authorization_servers:[url.replace(/\/$/,'')+'/auth/v1'],
    scopes_supported:['openid','profile'],bearer_methods_supported:['header']};
}
