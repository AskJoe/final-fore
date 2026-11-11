import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import next from 'next';
import { chromium } from '@playwright/test';
import { startResearchFixture } from '../tests/research-fixture';

async function main(){
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  const fixture=await startResearchFixture(54329),server=createServer(),app=next({dev:false,hostname:'127.0.0.1'});
  const browser=await chromium.launch({headless:true});
  const output='.superpowers/sdd/2026-11-11-media-research-email';fs.mkdirSync(output,{recursive:true});
  try{
    await app.prepare();server.on('request',app.getRequestHandler());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
    const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.href);return route.abort();}return route.continue();});
    assert.equal((await context.request.get(base+'/api/research/workspace')).status(),401);
    await page.goto(base+'/research/templates');await page.waitForURL('**/login');
    await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('fixture-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    await page.goto(base+'/research/templates');await page.getByRole('heading',{name:'Templates',exact:true}).waitFor();
    assert.equal(await page.locator('.research-market-options input:checked').count(),29);
    await page.getByRole('tab',{name:/TV · Multi-market/}).click();assert.equal(await page.locator('.research-market-options input:checked').count(),32);
    await page.getByLabel('Full email',{exact:true}).fill((await page.getByLabel('Full email',{exact:true}).inputValue())+'\nTest edit.');
    assert.equal(await page.getByText('Unsaved changes',{exact:true}).count(),1);
    await page.getByRole('tab',{name:/Radio · Multi-market/}).click();assert.equal(await page.getByText('Unsaved changes',{exact:true}).count(),0,'dirty state belongs to each template');
    await page.getByRole('tab',{name:/TV · Multi-market/}).click();assert.equal(await page.getByText('Unsaved changes',{exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Save template',exact:true}).isDisabled(),true);
    await page.screenshot({path:output+'/templates-desktop.png',fullPage:true});
    await page.goto(base+'/research/new');
    const john=page.getByRole('row').filter({hasText:'John Wahlert'});await john.getByRole('checkbox').check();
    await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Preview',exact:true}).click();
    await page.locator('.research-email-body').waitFor();
    const body=await page.locator('.research-email-body').innerText();assert.ok(body.includes('Boise, ID'));assert.ok(body.includes('Springfield (Ozarks), MO'));assert.ok(body.includes('Station Coverage Maps'));
    assert.equal(await page.locator('input[aria-label="Find template market"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'Send emails',exact:true}).isDisabled(),true);
    const result=await context.request.post(base+'/api/research/preview',{headers:{origin:base},data:{templateId:'tv-multi',repId:(await(await context.request.get(base+'/api/research/workspace')).json()).reps.find((r:{name:string})=>r.name==='John Wahlert').id,deadline:'2026-12-01',marketIds:['epic3-austin']}});assert.equal(result.status(),400);
    assert.equal((await context.request.post(base+'/api/research/send',{headers:{origin:base},data:{}})).status(),503);
    assert.equal((await context.request.post(base+'/api/research/templates/save',{headers:{origin:'https://other.example'},data:{}})).status(),403);
    await page.screenshot({path:output+'/preview-desktop.png',fullPage:true});
    for(const width of [876,390]){await page.setViewportSize({width,height:850});await page.screenshot({path:output+`/preview-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(!fixture.calls.some(c=>c.startsWith('POST /rest/v1')));
    console.log('PASS: auth, exact template cities, independent template edits, full preview, no request market controls, send gate, CSRF, responsive layout; no database writes or external requests.');
  }finally{await browser.close();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await app.close();await fixture.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
