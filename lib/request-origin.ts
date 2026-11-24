/** Hosted links and CSRF checks use the configured public origin, never proxy ports. */
export function requestOrigin(request:Request,configured=process.env.FINAL_FORE_RESEARCH_ORIGIN){
  if(configured){
    const publicUrl=new URL(configured);
    if(publicUrl.protocol==='https:'&&!publicUrl.username&&!publicUrl.password&&publicUrl.pathname==='/'&&!publicUrl.search&&!publicUrl.hash)return publicUrl.origin;
  }
  const url=new URL(request.url);
  // Setting host alone can preserve the old internal port when the new host has none.
  const host=request.headers.get('host');
  return host?new URL(url.protocol+'//'+host).origin:url.origin;
}

export function canonicalRenderRedirect(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const render = URL.parse(process.env.RENDER_EXTERNAL_URL ?? '');
  if (render?.protocol !== 'https:' || request.headers.get('host') !== render.host) return null;
  const canonical = new URL(requestOrigin(request));
  if (canonical.protocol !== 'https:' || canonical.origin === render.origin) return null;

  const incoming = new URL(request.url);
  canonical.pathname = incoming.pathname;
  canonical.search = incoming.search;
  return canonical;
}
