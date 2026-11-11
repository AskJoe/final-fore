import { AccessError } from './access';
import { Conflict, InputError } from './domain/types';
import { StorageError } from './store';
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: privateHeaders }); }
export function failure(error: unknown) {
  if (error instanceof AccessError) return json({error:error.message},error.status);
  if (error instanceof Conflict) return json({error:error.message},409);
  if (error instanceof InputError || error instanceof SyntaxError) return json({error:error.message},400);
  if (error instanceof StorageError) return json({error:error.message},503);
  console.error('Final Fore request failed:', error instanceof Error ? error.name : 'Unknown error');
  return json({error:'Unable to complete the request. Your changes were not saved.'},500);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  // API writes are browser-only. Do not trust forwarded host headers for this check.
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  return origin === url.protocol + '//' + host && request.headers.get('sec-fetch-site') !== 'cross-site';
}
