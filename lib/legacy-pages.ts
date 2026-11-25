import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const workbookFiles = ['clients.html','vendors.html','directory.js','directory.css','index.html','markets.html','campaign.html','orders.html','legacy-orders.html','app.js','styles.css','markets.js','markets.css','campaign.js','campaign-calc.js','campaign.css','orders.js','orders.css','orders-print.css','legacy-orders.js','legacy-orders.css','favicon.svg'];
const reportFiles = ['data.html','dashboard.html','reporting.js','reporting-model.js','reporting.css'];
export const available = new Set([...workbookFiles,...reportFiles]);
// These scripts embed contact data, so they are never left in a browser cache.
const dataScripts = new Set(['orders.js','legacy-orders.js']);
/** Styles and code-only scripts may be kept by the browser when requested by content version. */
export const browserCacheable = (name:string) => available.has(name) && (name.endsWith('.css') || name.endsWith('.js') && !dataScripts.has(name));
const versions = new Map<string,Promise<string>>();
/** A content hash, so a page always asks for the script and styles it was built with. */
export function assetVersion(name:string) {
  const known = versions.get(name);
  if (known) return known;
  const version = legacyAsset(name).then(({content}) => createHash('sha256').update(content).digest('hex').slice(0,16));
  // Files only change with a deploy; development re-reads them on every request.
  if (process.env.NODE_ENV === 'production') { versions.set(name,version); version.catch(() => versions.delete(name)); }
  return version;
}
const brandIcon = '<link rel="icon" href="/brand/favicon.png" type="image/png" sizes="32x32">';
const sidebarBrand = `<div class="sidebar-brand ff-sidebar-brand">
  <img src="/brand/final-fore-monogram.png" alt="" width="23" height="36">
  <div><strong>Final Fore</strong><span>Media planning</span></div>
</div>`;
const signOut = '<form class="ff-sign-out" action="/logout" method="post"><button type="submit"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 3H3v14h5m-1-7h10m-4-4 4 4-4 4"/></svg><span>Sign out</span></button></form>';
// Keep the existing DOM, keyboard handlers, recovery storage, and print CSS intact.
// The adapter applies shared navigation, branding, and status wording for Next.js.
export async function legacyAsset(name:string) {
  const loaders: Record<string, () => Promise<string>> = {
    'clients.html': () => readFile(path.join(process.cwd(), 'epic3/web/directory.html'), 'utf8'),
    'vendors.html': () => readFile(path.join(process.cwd(), 'epic3/web/directory.html'), 'utf8'),
    'directory.js': () => readFile(path.join(process.cwd(), 'epic3/web/directory.js'), 'utf8'),
    'directory.css': () => readFile(path.join(process.cwd(), 'epic3/web/directory.css'), 'utf8'),
    'index.html': () => readFile(path.join(process.cwd(), 'epic3/web/index.html'), 'utf8'),
    'markets.html': () => readFile(path.join(process.cwd(), 'epic3/web/markets.html'), 'utf8'),
    'campaign.html': () => readFile(path.join(process.cwd(), 'epic3/web/campaign.html'), 'utf8'),
    'orders.html': () => readFile(path.join(process.cwd(), 'epic3/web/orders.html'), 'utf8'),
    'legacy-orders.html': () => readFile(path.join(process.cwd(), 'epic3/web/legacy-orders.html'), 'utf8'),
    'app.js': () => readFile(path.join(process.cwd(), 'epic3/web/app.js'), 'utf8'),
    'styles.css': () => readFile(path.join(process.cwd(), 'epic3/web/styles.css'), 'utf8'),
    'markets.js': () => readFile(path.join(process.cwd(), 'epic3/web/markets.js'), 'utf8'),
    'markets.css': () => readFile(path.join(process.cwd(), 'epic3/web/markets.css'), 'utf8'),
    'campaign.js': () => readFile(path.join(process.cwd(), 'epic3/web/campaign.js'), 'utf8'),
    'campaign-calc.js': () => readFile(path.join(process.cwd(), 'epic3/web/campaign-calc.js'), 'utf8'),
    'campaign.css': () => readFile(path.join(process.cwd(), 'epic3/web/campaign.css'), 'utf8'),
    'orders.js': () => readFile(path.join(process.cwd(), 'epic3/web/orders.js'), 'utf8'),
    'orders.css': () => readFile(path.join(process.cwd(), 'epic3/web/orders.css'), 'utf8'),
    'orders-print.css': () => readFile(path.join(process.cwd(), 'epic3/web/orders-print.css'), 'utf8'),
    'legacy-orders.js': () => readFile(path.join(process.cwd(), 'epic3/web/legacy-orders.js'), 'utf8'),
    'legacy-orders.css': () => readFile(path.join(process.cwd(), 'epic3/web/legacy-orders.css'), 'utf8'),
    'favicon.svg': () => readFile(path.join(process.cwd(), 'epic3/web/favicon.svg'), 'utf8'),
    'data.html': () => readFile(path.join(process.cwd(), 'epic3/reporting/web/data.html'), 'utf8'),
    'dashboard.html': () => readFile(path.join(process.cwd(), 'epic3/reporting/web/dashboard.html'), 'utf8'),
    'reporting.js': () => readFile(path.join(process.cwd(), 'epic3/reporting/web/reporting.js'), 'utf8'),
    'reporting-model.js': () => readFile(path.join(process.cwd(), 'epic3/reporting/web/reporting-model.js'), 'utf8'),
    'reporting.css': () => readFile(path.join(process.cwd(), 'epic3/reporting/web/reporting.css'), 'utf8'),
  };
  let content = await loaders[name]();
  if (name==='clients.html'||name==='vendors.html') {
    const shell=await readFile(path.join(process.cwd(),'epic3/web/campaign.html'),'utf8');
    content=content.replace('<!--SHARED_NAV_STYLE-->',shell.match(/<style id="workbook-navigation-styles">[\s\S]*?<\/style>/)![0]);
    content=content.replace('<!--SHARED_NAV-->',shell.match(/<footer>[\s\S]*?<\/footer>/)![0].replace(' aria-current="page"','').replace('Draft campaign · saved on this computer','Client and vendor directory'));
  }
  if(name.endsWith('.html')) {
    content=content.replace(/<a\b[^>]*\bdata-tab="orders"[^>]*>[\s\S]*?<\/a>/g,'');
    if (name === 'orders.html' || name === 'legacy-orders.html') {
      content=content.replace('data-tab="campaign"','data-tab="campaign" aria-current="page"');
    }
    const links=[['clients','Clients'],['vendors','Vendors']].map(([id,label])=>`<a class="workbook-tab" href="/${id}.html" aria-label="${label}" title="${label}"${name===id+'.html'?' aria-current="page"':''}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 17V6l7-3 7 3v11H3M7 8v1M13 8v1M7 12v1M13 12v1"/></svg><span class="nav-label">${label}</span></a>`).join('')+'<a class="workbook-tab" href="/research/new" aria-label="Research" title="Research"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h16v11H2zM2 5l8 6 8-6"/></svg><span class="nav-label">Research</span></a>';
    content=content.replace(/(<nav class="workbook-nav"[^>]*>[\s\S]*?)(<\/nav>)/,(_,navigation,close)=>navigation+links+close);
    content=content.replace('<div class="sidebar-brand"><span class="sidebar-mark" aria-hidden="true">ff</span><div><strong>Final Fore</strong><span>Weed Man</span></div></div>',sidebarBrand);
    content=content.replace('<html lang="en">','<html lang="en" class="ff-workspace">')
      .replace(/<link rel="icon" href="\/favicon\.svg"(?: type="image\/svg\+xml")?>/,brandIcon)
      .replace('</head>','<link rel="stylesheet" href="/brand/theme.css" media="screen"></head>');
    content=content.replace('aria-label="EPIC3" title="EPIC3"','aria-label="Media planning" title="Media planning"').replace('<span class="nav-label">EPIC3</span>','<span class="nav-label">Media planning</span>');
  }
  if (/\.(html|js)$/.test(name)) content=content.replaceAll('Saved locally','Saved to Supabase').replaceAll('saved locally','saved to Supabase').replaceAll('saved on this computer','saved to Supabase').replaceAll('Opening local table…','Opening workbook…').replaceAll('Unable to open the local database.','Unable to open the workbook. Sign in again or confirm the data import is complete.').replaceAll('The local app could not be reached.','Final Fore could not be reached.').replaceAll('Reload after the local app update.','Confirm the workbook import is complete.');
  if (name.endsWith('.html')) content=content.replace('</footer>',signOut+'</footer>');
  if (name.endsWith('.html')) {
    const reference=/\b(href|src)="\/([\w-]+\.(?:css|js))(?:\?[^"]*)?"/g;
    const files=[...new Set([...content.matchAll(reference)].map(match=>match[2]).filter(browserCacheable))];
    const hashes=new Map(await Promise.all(files.map(async file=>[file,await assetVersion(file)] as const)));
    content=content.replace(reference,(whole,attribute,file)=>hashes.has(file)?`${attribute}="/${file}?v=${hashes.get(file)}"`:whole);
  }
  const type = name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/svg+xml';
  return {content,type};
}
