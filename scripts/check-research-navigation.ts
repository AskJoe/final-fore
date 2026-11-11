import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import next from 'next';
import { chromium, expect } from '@playwright/test';
import { startResearchFixture } from '../tests/research-fixture';

async function main(){
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED='0';process.env.FINAL_FORE_RESEARCH_SEND_ENABLED='0';
  const fixture=await startResearchFixture(54329),server=createServer(),app=next({dev:false,hostname:'127.0.0.1'}),browser=await chromium.launch({headless:true});
  try{
    await app.prepare();server.on('request',app.getRequestHandler());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors:string[]=[],external:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
    await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    for(const path of ['/research/new','/research/templates','/research','/research/files','/research/11111111-1111-4111-8111-111111111111']){
      await page.goto(base+path);const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});await expect(nav).toBeVisible();
      for(const name of ['Media planning','Markets','Campaign','Orders','Reporting data','Dashboard','Clients','Vendors','Research'])await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
      await expect(nav.getByRole('link',{name:'Research',exact:true})).toHaveAttribute('aria-current','page');
    }
    await page.goto(base+'/research/new');await expect(page.getByRole('region',{name:'Email preview',exact:true})).toHaveCount(0);
    await page.getByRole('row').filter({hasText:'John Wahlert'}).getByRole('checkbox').check();await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');
    for(const width of [1280,876,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(page.getByRole('navigation',{name:'Main navigation',exact:true})).toBeVisible();}
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local-migration/research-reps-sidebar.png',fullPage:false});
    await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.locator('.research-email-body')).toContainText('Station Coverage Maps');await expect(page.getByRole('region',{name:'Select reps',exact:true})).toHaveCount(0);
    for(const width of [1280,876,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(page.getByRole('navigation',{name:'Main navigation',exact:true})).toBeVisible();}
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local-migration/research-preview-sidebar.png',fullPage:false});
    await page.getByRole('button',{name:'Back to reps',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'John Wahlert'}).getByRole('checkbox')).toBeChecked();await expect(page.getByLabel('Due date',{exact:true})).toHaveValue('2026-12-01');await expect(page.getByRole('region',{name:'Email preview',exact:true})).toHaveCount(0);
    await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Vendors',exact:true}).click();await page.waitForURL('**/vendors.html');await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Research',exact:true}).click();await page.waitForURL('**/research/new');await expect(page.getByRole('heading',{name:'Reps & email',exact:true})).toBeVisible();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS persistent main sidebar across all five research routes, Vendors round trip, preview opens only on click, Back retains selections/date, desktop/mobile layouts. Local fixture only; no email or database writes.');
  }finally{await browser.close();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await app.close();await fixture.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
