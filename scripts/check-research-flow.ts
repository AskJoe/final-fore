import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import next from 'next';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { startResearchFlowFixture } from '../tests/research-flow-fixture';
import { verifyStorageFile } from '../lib/research/uploads';
import { unseal } from '../lib/research/secrets';

async function main(){
  assert.equal(process.env.FINAL_FORE_TEST_BUILD,'1');assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54329');
  Object.assign(process.env,{SUPABASE_SECRET_KEY:'fixture-service-key',FINAL_FORE_RESEARCH_WRITES_ENABLED:'1',FINAL_FORE_RESEARCH_SEND_ENABLED:'1',RESEND_API_KEY:'re_local_fixture_only',FINAL_FORE_RESEARCH_REPLY_DOMAIN:'reply.example.test',FINAL_FORE_RESEARCH_FROM:'Sarah <research@example.test>',FINAL_FORE_RESEARCH_SARAH_EMAIL:'sarah@example.test',FINAL_FORE_RESEARCH_SECRET_KEY:'01'.repeat(32),FINAL_FORE_RESEARCH_SCANNER_URL:'http://127.0.0.1:54329/scanner',FINAL_FORE_RESEARCH_SCANNER_KEY:'fixture-only'});
  // Hard stop if application code attempts any external transport during this local test.
  const originalFetch=globalThis.fetch,external:string[]=[];
  globalThis.fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:input.toString());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.origin);throw new Error('External transport forbidden in local research test.');}return originalFetch(input,init);};
  const fixture=await startResearchFlowFixture(54329),server=createServer(),app=next({dev:false,hostname:'127.0.0.1'}),browser=await chromium.launch({headless:true});
  const output='.superpowers/sdd/2026-11-11-media-research-email';fs.mkdirSync(output,{recursive:true});
  try{
    await app.prepare();server.on('request',app.getRequestHandler());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;process.env.FINAL_FORE_RESEARCH_ORIGIN=base;
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.origin);return route.abort();}return route.continue();});
    await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('fixture-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    await page.goto(base+'/research/templates');await page.getByRole('tab',{name:/Radio · Multi-market/}).click();assert.equal(await page.getByRole('button',{name:'Save template',exact:true}).isEnabled(),true,'An unchanged source template must be saveable after schema setup.');
    await page.goto(base+'/research/new');const jake=page.getByRole('row').filter({hasText:'Jake Sorensen'});await jake.getByRole('checkbox').check();await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Preview',exact:true}).click();await page.locator('.research-email-body').waitFor();
    assert.ok((await page.locator('.research-email-body').innerText()).includes('Lincoln, NE'));assert.equal(await page.getByRole('button',{name:'Send emails',exact:true}).isEnabled(),true);
    const prepared=fixture.tables.ff_research_previews[0].payload;
    await page.getByRole('button',{name:'Send preview',exact:true}).click();await page.getByRole('link',{name:'Open test upload page'}).waitFor();const testUrl=await page.getByRole('link',{name:'Open test upload page'}).getAttribute('href');assert.ok(testUrl);
    const portalToken=unseal<{portalToken:string}>(prepared.secrets,Buffer.from('01'.repeat(32),'hex')).portalToken,portalUrl=base+'/research-upload/'+portalToken;assert.notEqual(testUrl,portalUrl);
    await page.getByRole('button',{name:'Send emails',exact:true}).click();await expect(page.getByRole('status')).toContainText('1 emails queued');
    assert.equal(fixture.tables.ff_research_conversations.filter(c=>c.mode==='live').length,1);assert.equal(fixture.tables.ff_research_deliveries.length,2);
    const vendor=unseal<any>(fixture.tables.ff_research_deliveries.find(d=>d.leg==='vendor').payload_ciphertext,Buffer.from('01'.repeat(32),'hex'));assert.equal(vendor.text,prepared.email.text);assert.ok(vendor.text.includes(portalToken));
    const incoming=await context.newPage();await incoming.goto(base+'/research/files');
    const rep=await context.newPage();rep.on('pageerror',e=>errors.push(e.message));await rep.goto(portalUrl);await rep.getByRole('heading',{name:'Lincoln, NE',exact:true}).waitFor();assert.ok(!(await rep.locator('body').innerText()).includes('Weed'));
    const small={name:'coverage.txt',mimeType:'text/plain',buffer:Buffer.from('Lincoln coverage details.')},large={name:'rates.txt',mimeType:'text/plain',buffer:Buffer.alloc(7*1024*1024,65)};
    fixture.pause();await rep.getByLabel('Upload files for Lincoln, NE').setInputFiles([small,large]);
    await expect.poll(()=>fixture.tables.ff_research_files.filter(f=>f.state==='ready').length).toBe(1);
    await expect.poll(()=>[...fixture.uploads.values()].some(u=>u.length===large.buffer.length&&u.bytes.length>0&&u.bytes.length<u.length)).toBe(true);
    // Returning to the same URL must retain the completed object and resumable reservation.
    rep.on('dialog',dialog=>dialog.accept());await rep.reload();await expect(rep.getByText('Choose file to resume',{exact:true})).toBeVisible();fixture.resume();
    await rep.getByLabel('Upload files for Lincoln, NE').setInputFiles([large]);await expect.poll(()=>fixture.tables.ff_research_files.filter(f=>f.state==='ready').length,{timeout:15000}).toBe(2);
    assert.equal(fixture.tables.ff_research_files.length,2,'resume must reuse the same reservation');
    const db=createClient('http://127.0.0.1:54329','fixture-service-key',{auth:{persistSession:false,autoRefreshToken:false}});
    for(const file of fixture.tables.ff_research_files)await verifyStorageFile(db,file.id,async()=>true);
    await rep.reload();await expect(rep.getByRole('link',{name:'coverage.txt',exact:true})).toBeVisible();await expect(rep.getByRole('link',{name:'rates.txt',exact:true})).toBeVisible();
    await expect(incoming.getByRole('link',{name:'coverage.txt',exact:true})).toBeVisible({timeout:15000});await expect(incoming.getByRole('link',{name:'rates.txt',exact:true})).toBeVisible();assert.equal(await incoming.locator('.research-sender').count(),1);
    assert.ok(fixture.tables.ff_research_files.every(f=>f.market_id==='epic3-lincoln'));assert.deepEqual(fixture.objects.get(fixture.tables.ff_research_files.find(f=>f.name==='rates.txt').object_key),large.buffer);
    const tamper=await context.request.post(base+'/api/research-upload/reserve',{headers:{origin:base},data:{token:portalToken,file:{marketId:'epic3-austin',name:'wrong.txt',size:1,sha256:'a'.repeat(64)}}});assert.equal(tamper.status(),400);
    await Promise.all([rep.waitForResponse(r=>r.url().endsWith('/research-upload/reserve')),rep.getByLabel('Upload files for Lincoln, NE').setInputFiles([small])]);await expect(rep.getByText('Checking file',{exact:true})).toHaveCount(0);assert.equal(fixture.tables.ff_research_files.length,2);await expect(rep.getByRole('link',{name:'coverage.txt',exact:true})).toBeVisible();
    const sample=await context.newPage();await sample.goto(testUrl);await sample.getByLabel('Upload files for Lincoln, NE').setInputFiles([{name:'preview-only.txt',mimeType:'text/plain',buffer:Buffer.from('Internal preview file.')}]);await expect.poll(()=>fixture.tables.ff_research_files.filter(f=>f.state==='ready'&&f.name==='preview-only.txt').length).toBe(1);
    const testFile=fixture.tables.ff_research_files.find(f=>f.name==='preview-only.txt');assert.notEqual(testFile.conversation_id,prepared.id);await verifyStorageFile(db,testFile.id,async()=>true);await incoming.reload();await expect(incoming.getByRole('link',{name:'coverage.txt',exact:true})).toBeVisible();assert.equal(await incoming.getByText('preview-only.txt',{exact:true}).count(),0);
    const crossPortal=await context.request.post(base+'/api/research-upload/finalize',{headers:{origin:base},data:{token:portalToken,fileId:testFile.id}});assert.equal(crossPortal.status(),400);
    const expired={name:'updated-rates.txt',mimeType:'text/plain',buffer:Buffer.alloc(7*1024*1024,66)};fixture.pause();await rep.getByLabel('Upload files for Lincoln, NE').setInputFiles([expired]);
    await expect.poll(()=>{const f=fixture.tables.ff_research_files.find(f=>f.name===expired.name);return !!f&&[...fixture.uploads.values()].some(u=>u.key===f.object_key&&u.bytes.length>0&&u.bytes.length<u.length);}).toBe(true);
    await rep.reload();fixture.expireUploads();fixture.resume();await rep.getByLabel('Upload files for Lincoln, NE').setInputFiles([expired]);await expect.poll(()=>fixture.tables.ff_research_files.find(f=>f.name===expired.name)?.state,{timeout:15000}).toBe('ready');
    const restarted=fixture.tables.ff_research_files.find(f=>f.name===expired.name);await verifyStorageFile(db,restarted.id,async()=>true);assert.deepEqual(fixture.objects.get(restarted.object_key),expired.buffer);assert.equal(fixture.tables.ff_research_files.filter(f=>f.name===expired.name).length,1);await rep.reload();await expect(rep.getByRole('link',{name:expired.name,exact:true})).toBeVisible();await expect(incoming.getByRole('link',{name:expired.name,exact:true})).toBeVisible({timeout:15000});
    await rep.screenshot({path:output+'/rep-upload-flow.png',fullPage:true});await incoming.screenshot({path:output+'/incoming-flow.png',fullPage:true});
    await incoming.goto(base+'/research');await expect(incoming.getByRole('link',{name:prepared.email.subject,exact:true})).toBeVisible();await incoming.getByRole('link',{name:prepared.email.subject,exact:true}).click();await expect(incoming.locator('.research-message-body')).toContainText('Lincoln, NE');await incoming.screenshot({path:output+'/thread-flow.png',fullPage:true});
    for(const width of [876,390]){await rep.setViewportSize({width,height:850});await incoming.setViewportSize({width,height:850});assert.ok(await rep.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await incoming.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    fixture.tables.ff_research_conversations.find(c=>c.id===prepared.id).portal_state='revoked';
    const revoked=await context.request.post(base+'/api/research-upload/finalize',{headers:{origin:base},data:{token:portalToken,fileId:restarted.id}});assert.equal(revoked.status(),400);await rep.reload();await expect(rep.getByText('This upload link is not available.',{exact:false})).toBeVisible();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS: real app/API + local HTTP fixture: prepared preview, isolated preview link, queued vendor/Gmail legs, multi-file TUS upload, interrupted upload/reload/resume, byte verification, duplicate suppression, wrong-market rejection, compact incoming files and thread. No real database or email; SQL/RLS and Gmail still require an approved pilot.');
  }finally{await browser.close();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await app.close();await fixture.close();globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
