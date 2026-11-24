import { createClient } from '@supabase/supabase-js';
import { requireMember } from '../access';
import { StorageError, SupabaseStore } from '../store';
import { Service } from '../service';
import { orderStore } from './store';

export function ordersSecret() {
  const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw new StorageError('Orders storage is unavailable.');
  return key;
}
export function ordersAdmin() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!url)throw new StorageError('Orders storage is unavailable.');
  return createClient(url,ordersSecret(),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)})}});
}
export async function orderRuntime(member?:Awaited<ReturnType<typeof requireMember>>&{researchApiKey?:string},admin=ordersAdmin()) {
  const {supabase,user}=member??await requireMember();
  const directoryStore=new SupabaseStore(supabase);
  return {user,supabase,researchApiKey:member?.researchApiKey,directoryStore,share:new Service(directoryStore),admin,orders:orderStore(admin)};
}
export type OrderRuntime=Awaited<ReturnType<typeof orderRuntime>>;
