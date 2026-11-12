import { createClient } from '@/utils/supabase/server';
import { cache } from 'react';
export class AccessError extends Error { constructor(message: string, public status: number) { super(message); } }
// React cache is scoped to one server render, never shared between users/requests.
export const requireMember = cache(async function requireMember() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AccessError('Please sign in to open Final Fore.', 401);
  const result = await supabase.from('ff_members').select('user_id').eq('user_id', user.id).maybeSingle();
  if (result.error) throw new AccessError('Final Fore storage is not ready. The reviewed Supabase setup must be applied first.', 503);
  if (!result.data) throw new AccessError('Your account has not been granted access to Final Fore.', 403);
  return { supabase, user };
});
