import { redirect } from 'next/navigation';
import { requireMember,AccessError } from '@/lib/access';
import { check } from '@/lib/domain/types';

export const dynamic='force-dynamic';
async function consent(form:FormData){
  'use server';
  const {supabase}=await requireMember();
  const id=String(form.get('authorization_id')??'');
  check(/^[a-z0-9_-]{1,200}$/i.test(id),'Invalid authorization request.');
  const details=await supabase.auth.oauth.getAuthorizationDetails(id);
  check(!details.error&&details.data,'This connection request is no longer available.');
  if('redirect_url' in details.data)redirect(details.data.redirect_url);
  check(details.data.client.id===process.env.FINAL_FORE_CHATGPT_OAUTH_CLIENT_ID,'This OAuth client is not approved for Final Fore.');
  const result=form.get('decision')==='allow'?
    await supabase.auth.oauth.approveAuthorization(id,{skipBrowserRedirect:true}):
    await supabase.auth.oauth.denyAuthorization(id,{skipBrowserRedirect:true});
  check(!result.error&&result.data,'Unable to complete authorization.');
  redirect(result.data.redirect_url);
}
export default async function Consent({searchParams}:{searchParams:Promise<{authorization_id?:string}>}){
  const {authorization_id:id}=await searchParams;
  check(id&&/^[a-z0-9_-]{1,200}$/i.test(id),'Open the connection request from ChatGPT.');
  let member;
  try{member=await requireMember();}catch(error){
    if(error instanceof AccessError&&error.status===401)redirect('/login?next='+encodeURIComponent('/oauth/consent?authorization_id='+id));
    throw error;
  }
  const result=await member.supabase.auth.oauth.getAuthorizationDetails(id);
  check(!result.error&&result.data,'This connection request is no longer available.');
  if('redirect_url' in result.data)redirect(result.data.redirect_url);
  check(result.data.client.id===process.env.FINAL_FORE_CHATGPT_OAUTH_CLIENT_ID,'This OAuth client is not approved for Final Fore.');
  return <main style={{maxWidth:560,margin:'60px auto',padding:24,fontFamily:'system-ui'}}>
    <h1>Connect Final Fore to ChatGPT</h1>
    <p>Allow {result.data.client.name} to review the market you open, save shortlist choices, and prepare draft changes for your review.</p>
    <p>Placement changes require Apply. This integration cannot finalize or send an order.</p>
    <form action={consent}><input type="hidden" name="authorization_id" value={id}/>
      <button name="decision" value="allow">Allow connection</button>{' '}
      <button name="decision" value="deny">Cancel</button></form>
  </main>;
}
