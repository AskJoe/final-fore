import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import next from 'next';
import {chromium,expect} from '@playwright/test';
import {startResearchFixture} from '../tests/research-fixture';
async function main(){
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED='0';process.env.FINAL_FORE_RESEARCH_SEND_ENABLED='0';
  const fixture=await startResearchFixture(54329),server=createServer(),app=next({dev:false,hostname:'127.0.0.1'}),browser=await chromium.launch({headless:true});
  try{
    await app.prepare();server.on('request',app.getRequestHandler());await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    const context=await browser.newContext({viewport:{width:876,height:900}}),page=await context.newPage(),errors:string[]=[],external:string[]=[],uploadCalls:string[]=[];
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.origin);return route.abort();}if(u.pathname.startsWith('/api/research-upload/')||u.pathname.startsWith('/storage/'))uploadCalls.push(u.pathname);return route.continue();});
    await page.goto(base+'/research-upload/preview?templateId=tv-multi&repId=test');await page.waitForURL('**/login');
    await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    const workspace=await (await context.request.get(base+'/api/research/workspace')).json();
    for(const [repName,id] of [['John Wahlert','tv-multi'],['Mike Donnelly','radio-multi'],['Jake Sorensen','radio-single-lincoln']]){
      await page.goto(base+'/research/new');const t=workspace.templates.find((t:{id:string})=>t.id===id);await page.getByRole('row').filter({hasText:repName}).getByRole('button',{name:t.name,exact:true}).click();
      const email=page.getByRole('tabpanel',{name:'HTML email',exact:true}),link=email.getByRole('link');await expect(link).toHaveAttribute('target','_blank');
      const href=await link.getAttribute('href');assert.ok(href);const u=new URL(href);assert.equal(u.searchParams.get('templateId'),id);assert.equal(u.searchParams.get('deadline'),'');
      const popupPromise=page.waitForEvent('popup');await link.click();const portal=await popupPromise;await expect(portal.getByRole('heading',{name:'Upload research',exact:true})).toBeVisible();
      await expect(portal.getByRole('heading',{level:2})).toHaveText(t.markets.map((m:{displayName:string})=>m.displayName));
      await expect(portal.getByText('Page preview · file uploads are disabled',{exact:true})).toBeVisible();assert.ok(!(await portal.locator('body').innerText()).includes('Weed Man'));
      for(const input of await portal.locator('input[type=file]').all())await expect(input).toBeDisabled();
      for(const width of [876,390]){await portal.setViewportSize({width,height:900});assert.ok(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
      await portal.getByLabel('Find market').fill(t.markets[0].displayName);await expect(portal.getByRole('heading',{level:2})).toHaveText([t.markets[0].displayName]);await portal.close();await expect(email).toBeVisible();
      // The route never accepts client-supplied markets or a different media assignment.
      u.searchParams.set('markets','injected');assert.equal((await context.request.get(u.href)).status(),404);
    }
    await page.goto(base+'/research/new');await page.getByRole('row').filter({hasText:'John Wahlert'}).getByRole('checkbox').check();await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Preview',exact:true}).click();
    const batchLink=page.locator('.research-email-body').getByRole('link');await expect(batchLink).toHaveAttribute('target','_blank');assert.equal(new URL((await batchLink.getAttribute('href'))!).searchParams.get('deadline'),'2026-12-01');
    assert.equal(fixture.calls.filter(c=>c.startsWith('POST /rest/v1/')||c.startsWith('PATCH /rest/v1/')).length,0);assert.deepEqual(uploadCalls,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS upload-page preview: authenticated access, row and batch links, exact29/32/single template markets, missing deadline allowed, search/mobile, no client name, invalid overrides rejected, no upload/storage/database writes.');
  }finally{await browser.close();if(server.listening)await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await app.close();await fixture.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
