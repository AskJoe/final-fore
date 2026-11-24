'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
export async function signIn(form:FormData) {
  const destination=String(form.get('next')??'');
  const resume=destination.startsWith('/oauth/consent?authorization_id=')&&/^\/oauth\/consent\?authorization_id=[a-zA-Z0-9_-]{1,200}$/.test(destination)?destination:'';
  const email=String(form.get('email')??'').trim(),password=String(form.get('password')??'');
  if(!email||!password||email.length>320||password.length>1024)redirect('/login?error=missing'+(resume?'&next='+encodeURIComponent(resume):''));
  const supabase=await createClient();
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error)redirect('/login?error=credentials'+(resume?'&next='+encodeURIComponent(resume):''));
  redirect(resume||'/index.html');
}
