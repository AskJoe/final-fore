import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './utils/supabase/middleware';
export async function proxy(request: NextRequest) { if(request.nextUrl.pathname==='/mcp'||request.nextUrl.pathname.startsWith('/.well-known/oauth-protected-resource'))return NextResponse.next(); return updateSession(request); }
export const config = { matcher: ['/((?!_next/static|_next/image|api/health|favicon.svg|brand/).*)'] };
