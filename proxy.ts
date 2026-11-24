import { NextResponse, type NextRequest } from 'next/server';
import { canonicalRenderRedirect } from './lib/request-origin';
import { updateSession } from './utils/supabase/middleware';
export async function proxy(request: NextRequest) {
  const canonical = canonicalRenderRedirect(request);
  if (canonical) return NextResponse.redirect(canonical, 308);
  if (request.nextUrl.pathname === '/mcp' || request.nextUrl.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return NextResponse.next();
  }
  return updateSession(request);
}
export const config = { matcher: ['/((?!_next/static|_next/image|api/health|favicon.svg|brand/).*)'] };
