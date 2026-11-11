import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from './config';
export async function createClient(cookieStore?: Awaited<ReturnType<typeof cookies>>) {
  const store = cookieStore ?? await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try { for (const { name, value, options } of values) store.set(name, value, options); }
        catch (error) {
          // Server Components cannot set cookies. Proxy refreshes them before rendering.
          if (!(error instanceof Error) || !error.message.includes('Cookies can only be modified')) throw error;
        }
      },
    },
  });
}
