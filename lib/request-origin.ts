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
