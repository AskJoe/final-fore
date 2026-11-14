'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
export async function signIn(form:FormData) {
  const email=String(form.get('email')??'').trim(),password=String(form.get('password')??'');
  if(!email||!password||email.length>320||password.length>1024)redirect('/login?error=missing');
  const supabase=await createClient();
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error)redirect('/login?error=credentials');
  redirect('/index.html');
}
