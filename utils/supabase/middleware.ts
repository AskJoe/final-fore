import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseConfig } from './config';
export async function updateSession(request: NextRequest) {
  const { url, key } = supabaseConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values) {
      for (const { name, value } of values) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of values) response.cookies.set(name, value, options);
    },
  } });
  // Verify the signature and refresh expired sessions. Protected routes still use
  // getUser plus a fresh membership query; no authorization decision is cached here.
  await supabase.auth.getClaims();
  // A header set here replaces the route's own. Versioned scripts and styles are
  // left to their route, which allows browser caching only for an exact content
  // version and answers everything else with no-store itself.
  const versionedAsset = /\.(?:css|js)$/.test(request.nextUrl.pathname) && request.nextUrl.searchParams.has('v');
  if (!versionedAsset) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
