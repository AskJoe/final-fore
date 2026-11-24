import { createClient } from '@/utils/supabase/server';
import { cache } from 'react';
import { AccessError } from './access-error';
export { AccessError } from './access-error';
// React cache is scoped to one server render, never shared between users/requests.
export const requireMember = cache(async function requireMember() {
  const supabase = await createClient();
  return memberForClient(supabase);
});
export async function memberForClient(supabase:Awaited<ReturnType<typeof createClient>>){
  // ff_members_self RLS exposes only auth.uid(). Both checks remain fresh, but
  // they can run together. Also match the returned row against the verified user.
  const [{ data: { user }, error },result] = await Promise.all([
    supabase.auth.getUser(),supabase.from('ff_members').select('user_id').maybeSingle(),
  ]);
  if (error || !user) throw new AccessError('Please sign in to open Final Fore.', 401);
  if (result.error) throw new AccessError('Final Fore storage is not ready. The reviewed Supabase setup must be applied first.', 503);
  if (!result.data||result.data.user_id!==user.id) throw new AccessError('Your account has not been granted access to Final Fore.', 403);
  return { supabase, user };
}
