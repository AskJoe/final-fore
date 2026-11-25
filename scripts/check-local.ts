import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import next from 'next';
import { chromium, type Browser } from '@playwright/test';
import { startMockSupabase } from '../tests/mock-supabase';
import { checkDirectory } from './check-directory';
import { checkPlanning } from './check-planning';
async function main() {
 assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
 const mock=await startMockSupabase(54329);
 // Let the OS reserve an available loopback port; never take over another app's port.
 const server=createServer();let browser:Browser|undefined;
 let app:ReturnType<typeof next>|undefined;
 try {
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const port=address.port;
 app=next({dev:false,hostname:'127.0.0.1',port});
 await app.prepare();server.on('request',app.getRequestHandler());
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.href);return route.abort();}return route.continue();});
 const base='http://127.0.0.1:'+port;console.log('Final Fore test server: '+base);let checks=0;const pass=(label:string)=>{checks++;console.log('PASS '+label);};
  for(const path of ['/api/table','/api/planning','/reporting-data.json','/legacy-orders.js','/api/directory','/directory.js']){const r=await context.request.get(base+path);assert.equal(r.status(),401);}pass('anonymous API, reporting, and embedded catalogs denied');
  await page.goto(base+'/');await page.waitForURL('**/login');
  await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password').fill('local-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');assert.equal(new URL(page.url()).origin,base);
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved to Supabase');pass('sign-in and workbook load');
  const cookie=(await context.cookies()).find(c=>c.name==='sb-127-auth-token');assert.ok(cookie);
  const refreshBefore=mock.calls.filter(c=>c==='POST /auth/v1/token').length;
  await context.addCookies([{...cookie,value:'base64-'+Buffer.from(JSON.stringify(mock.token(-120))).toString('base64url')}]);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved to Supabase');
  assert.ok(mock.calls.filter(c=>c==='POST /auth/v1/token').length>refreshBefore);
  const refreshedCookie=(await context.cookies()).find(c=>c.name==='sb-127-auth-token');assert.ok(refreshedCookie);
  assert.ok(JSON.parse(Buffer.from(refreshedCookie.value.slice(7),'base64url').toString()).expires_at>Date.now()/1000);pass('expired session refresh updates browser cookies');
  mock.setMemberAllowed(false);assert.equal((await context.request.get(base+'/api/table')).status(),403);assert.equal((await context.request.get(base+'/reporting-data.json')).status(),403);mock.setMemberAllowed(true);pass('signed-in account without membership denied');
  await page.locator('#address').fill('DP8');await page.locator('#address').press('Enter');await page.locator('#formula').fill('1234');await page.locator('#save-cell').click();await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved to Supabase');
  const workbookResponse=await context.request.get(base+'/api/table');assert.equal(workbookResponse.status(),200,await workbookResponse.text());const w=await workbookResponse.json();assert.equal(w.cells.DP8.value,1234);pass('UI workbook save reaches Supabase adapter');
  const csrf=await context.request.post(base+'/api/cell',{headers:{origin:'https://other.example'},data:{address:'DP8',text:'5',revision:w.revision}});assert.equal(csrf.status(),403);
  const stale=await context.request.post(base+'/api/cell',{headers:{origin:base},data:{address:'DP8',text:'5',revision:w.revision-1}});assert.equal(stale.status(),409);pass('cross-origin writes and stale revisions rejected');
  await page.goto(base+'/?cell=DP8');await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('#address')?.value==='DP8');pass('root cell deep links retained');
  for(const [path,selector] of [['/markets.html','#sheet'],['/markets.html#variables','#sheet'],['/campaign.html?workflow=digital','#campaign-picker'],['/legacy-orders.html','#market']]){
    await page.goto(base+path);await page.locator(selector).waitFor({state:'visible'});await page.waitForLoadState('networkidle');assert.equal(await page.locator('#message:visible').count(),0,path);pass(path+' loaded');
  }
  {
    const html=await (await context.request.get(base+'/campaign.html')).text(),script=html.match(/src="(\/campaign\.js\?v=[a-f0-9]{16})"/)?.[1];assert.ok(script);
    assert.equal((await context.request.get(base+script)).headers()['cache-control'],'private, max-age=31536000, immutable');
    for(const fresh of ['/campaign.js','/campaign.js?v=old','/legacy-orders.js?v=old','/campaign.html','/api/campaigns'])assert.equal((await context.request.get(base+fresh)).headers()['cache-control'],'private, no-store',fresh);
    pass('only content-versioned code and styles are browser-cacheable');
  }
  await page.locator('#preview').click();await page.locator('#paper').waitFor({state:'visible'});assert.ok((await page.locator('#paper').innerText()).includes('Weed Man'));await page.pdf({path:'.local-migration/legacy-order-preview.pdf',format:'Letter'});pass('legacy order preview and PDF rendering');
  const orders=JSON.parse(fs.readFileSync('.local-migration/campaign-orders.json','utf8')),order=orders[0];
  await page.goto(base+'/orders.html?campaign='+encodeURIComponent(order.campaign_id)+'&market='+encodeURIComponent(order.market_id));await page.locator('#editor').waitFor({state:'visible'});await page.locator('#preview').click();await page.locator('#paper').waitFor({state:'visible'});await page.pdf({path:'.local-migration/campaign-order-preview.pdf',format:'Letter'});pass('campaign order load, preview and PDF rendering');
  {
    const previews:string[]=[];page.on('request',r=>{if(r.url().includes('/api/campaign/preview'))previews.push(r.url());});
    await page.goto(base+'/campaign.html?workflow=digital');await page.locator('#campaign-picker').waitFor({state:'visible'});await page.waitForLoadState('networkidle');
    // Keep this check from creating a campaign: the edit is recalculated, never saved.
    await page.route('**/api/campaign',r=>r.request().method()==='POST'?r.abort():r.continue());
    const before=await page.locator('#market-rows').evaluate(node=>node.textContent);
    await page.locator('#campaign-budget').fill('250000');await page.locator('#campaign-budget').blur();
    await page.waitForFunction(text=>document.querySelector('#market-rows')!.textContent!==text,before);
    assert.equal(await page.locator('#message:visible').count(),0);assert.deepEqual(previews,[]);
    pass('campaign edits recalculate in the browser without a server round trip');
    await page.goto(base+'/markets.html');await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('ffm.campaign.recovery.'))localStorage.removeItem(key);});
    await page.unroute('**/api/campaign');
    await page.goto(base+'/campaign.html?workflow=digital');await page.locator('#campaign-picker').waitFor({state:'visible'});await page.waitForLoadState('networkidle');
    await page.route('**/api/**',r=>r.abort());
    await page.reload();await page.locator('#campaign-picker').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='Final Fore could not be reached. Showing the copy kept on this computer.');
    assert.ok(await page.locator('#market-rows').evaluate(node=>node.children.length>0));
    await page.unroute('**/api/**');
    pass('campaign page opens from its saved copy when the server cannot be reached');
  }
  for(const path of ['/data.html','/dashboard.html']) {await page.goto(base+path);await page.waitForFunction(()=>document.querySelector('#freshness')?.textContent?.includes('Through'));assert.equal(await page.locator('#load-state:visible').count(),0);pass(path+' reporting snapshot loaded');}
  await page.screenshot({path:'.local-migration/dashboard-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.goto(base+'/campaign.html');await page.waitForLoadState('networkidle');await page.screenshot({path:'.local-migration/campaign-mobile.png',fullPage:true});pass('desktop and mobile screenshots captured');
  await checkDirectory(page,context,base,pass);
  await checkPlanning(page,context,base,mock.store,pass);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL('**/login');assert.equal((await context.request.get(base+'/api/table')).status(),401);assert.equal((await context.request.get(base+'/api/directory')).status(),401);pass('sign-out removes access');
  await page.waitForFunction(async()=>!(await caches.keys()).includes('ffm-campaign-saved-v1'));pass('sign-in page clears the saved campaign copies');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(mock.calls.some(c=>c.includes('/rpc/ff_save_record')));pass('no browser runtime errors or external browser requests');
  fs.writeFileSync('.local-migration/browser-checks.json',JSON.stringify({checks,errors,external,testPort:port,supabaseRequests:mock.calls.length,backend:'local mock; no remote project calls'},null,2));
  console.log(`${checks} local integration checks passed.`);
 } finally {
  await browser?.close();
  if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  await app?.close();await mock.close();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
