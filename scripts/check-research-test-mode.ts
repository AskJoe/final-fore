// Loopback-only UI and server guard check. No real database or provider calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import next from 'next';
import {chromium,expect} from '@playwright/test';
import {startResearchFlowFixture} from '../tests/research-flow-fixture';

async function main(){
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  Object.assign(process.env,{SUPABASE_SECRET_KEY:'fixture-service-key',FINAL_FORE_RESEARCH_WRITES_ENABLED:'1',FINAL_FORE_RESEARCH_SEND_ENABLED:'1',FINAL_FORE_RESEARCH_TEST_ONLY:'1',RESEND_API_KEY:'re_local_fixture_only',FINAL_FORE_RESEARCH_REPLY_DOMAIN:'finalforemedia.com',FINAL_FORE_RESEARCH_FROM:'sarah@finalforemedia.com',FINAL_FORE_RESEARCH_SARAH_EMAIL:'sarah@finalforemedia.com',FINAL_FORE_RESEARCH_SECRET_KEY:'01'.repeat(32)});
  delete process.env.FINAL_FORE_RESEARCH_SCANNER_URL;delete process.env.FINAL_FORE_RESEARCH_SCANNER_KEY;
  const originalFetch=globalThis.fetch,external:string[]=[];
  globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:input.toString());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);throw new Error('External requests forbidden.');}return originalFetch(input,init);};
  const fixture=await startResearchFlowFixture(54329),server=createServer(),app=next({dev:false,hostname:'127.0.0.1'}),browser=await chromium.launch({headless:true});
  try{
    const savedTemplate = fixture.tables.ff_research_templates[0].payload;
    savedTemplate.body = savedTemplate.body
      .replace('Feb ’26 through Sept ‘26', '{{radio_trender_books}}')
      .replace("Mar ‘26, July '26 AND Sept '26", '{{ranker_books}}')
      .replace('Feb-May ’27', '{{flight_dates}}');
    Object.assign(savedTemplate.defaults, {radio_trender_books:'', ranker_books:'October 2026', flight_dates:''});
    await app.prepare();server.on('request',app.getRequestHandler());await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;process.env.FINAL_FORE_RESEARCH_ORIGIN=base;
    const context=await browser.newContext({viewport:{width:876,height:850}}),page=await context.newPage(),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
    await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    await page.goto(base+'/research/new');await expect(page.getByText('Test mode · vendor sending blocked',{exact:true})).toBeVisible();
    await page.getByRole('row').filter({hasText:'Jake Sorensen'}).getByRole('checkbox').check();
    await expect(page.getByRole('button',{name:'Preview',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Edit fields',exact:true}).click();
    const fields=page.getByRole('dialog',{name:'Edit fields',exact:true});
    for(const label of ['Flight dates','Radio trender books','Ranker books','TV books','Availability book'])await expect(fields.getByLabel(label,{exact:true})).toHaveCount(0);
    await fields.getByLabel('Due date',{exact:true}).fill('2026-12-01');
    await fields.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('button',{name:'Preview',exact:true}).click();
    await expect(page.locator('.research-email-body')).toContainText('Lincoln, NE');
    await expect(page.locator('.research-email-body')).toContainText('Feb ’26 through Sept ‘26');
    await expect(page.locator('.research-email-body')).toContainText('October 2026 only');
    await expect(page.locator('.research-email-body')).toContainText('Feb-May ’27');
    await expect(page.locator('.research-email-body')).toContainText('2026-12-01');
    await expect(page.getByLabel('Test email addresses')).toHaveValue('');await expect(page.getByRole('button',{name:'Send test email',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Send emails',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Send preview',exact:true})).toHaveCount(0);
    await page.getByLabel('Test email addresses').fill('tester@example.com, second@example.com');await expect(page.getByRole('button',{name:'Send test email',exact:true})).toBeEnabled();
    for(const action of ['send','send-preview','reply']){const response=await context.request.post(base+'/api/research/'+action,{headers:{origin:base},data:{}});assert.equal(response.status(),403,action);assert.match((await response.json()).error,/Test mode/);}
    const invalid=await context.request.post(base+'/api/research/send-test',{headers:{origin:base},data:{templateId:'radio-single-lincoln',repId:fixture.tables.ff_research_templates[0].payload.id,deadline:'2026-12-01',testRecipients:'',renderHash:'a'.repeat(64),idempotencyKey:crypto.randomUUID()}});assert.equal(invalid.status(),400);
    assert.equal(fixture.tables.ff_research_previews.length,0);assert.equal(fixture.tables.ff_research_deliveries.length,0);assert.equal(fixture.tables.ff_research_conversations.length,0);
    for(const width of [876,390]){await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.screenshot({path:'.local-migration/test-only-email-preview.png',fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS single-market radio test is ready with a due date and explicit test addresses. Books and flight dates are in the preview. Vendor send controls are absent, send/preview/reply endpoints returned 403, and no real email was sent.');
  }finally{await browser.close();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));await app.close();await fixture.close();globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
