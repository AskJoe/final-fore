/** Read-only screen/API verification of the approved local app, after restart. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect, type Page } from '@playwright/test';

async function unexpectedAlerts(page:Page){
  return page.getByRole('alert').evaluateAll(elements=>elements
    // Next mounts an empty accessibility announcer even when the page has no error.
    // Ignore only that empty framework element; retain all application alerts.
    .filter(el=>el.id!=='__next-route-announcer__'||!!el.textContent?.trim())
    .map(el=>({id:el.id,text:el.textContent?.trim()??''})));
}

async function main(){
  const base='http://127.0.0.1:3000';
  assert.match(fs.readFileSync('.env.local','utf8'),/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321\s*$/m);
  assert.match(fs.readFileSync('.env.local','utf8'),/^FINAL_FORE_RESEARCH_SEND_ENABLED=0\s*$/m);
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors:string[]=[],external:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
    const alertFixture=await context.newPage();
    await alertFixture.setContent('<div role="alert" id="__next-route-announcer__"> </div><p role="alert">Unable to load inbox.</p><p role="alert" id="empty-app-alert"></p>');
    assert.deepEqual(await unexpectedAlerts(alertFixture),[{id:'',text:'Unable to load inbox.'},{id:'empty-app-alert',text:''}]);
    await alertFixture.setContent('<div role="alert" id="__next-route-announcer__">Unexpected announcement</div>');
    assert.deepEqual(await unexpectedAlerts(alertFixture),[{id:'__next-route-announcer__',text:'Unexpected announcement'}]);
    await alertFixture.close();
    assert.equal((await context.request.get(base+'/api/research/workspace')).status(),401);
    await page.goto(base+'/research/templates');await page.waitForURL('**/login');
    await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password').fill('local-test-password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    const response=await context.request.get(base+'/api/research/workspace');assert.equal(response.status(),200);
    const workspace=await response.json();assert.equal(workspace.installed,true);assert.equal(workspace.canSave,true);assert.equal(workspace.canSend,false);
    await page.goto(base+'/research/templates');await page.getByRole('heading',{name:'Templates',exact:true}).waitFor();
    await page.getByRole('tab',{name:/Radio · Multi-market/}).click();assert.equal(await page.locator('.research-market-options input:checked').count(),29);
    assert.equal(await page.getByRole('button',{name:'Save template',exact:true}).isEnabled(),true);
    await page.getByRole('tab',{name:/TV · Multi-market/}).click();assert.equal(await page.locator('.research-market-options input:checked').count(),32);
    await page.goto(base+'/research/new');await page.getByRole('row').filter({hasText:'John Wahlert'}).getByRole('checkbox').check();
    await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Preview',exact:true}).click();
    await page.locator('.research-email-body').waitFor();const body=await page.locator('.research-email-body').innerText();
    for(const text of ['Boise, ID','Springfield (Ozarks), MO','Station Coverage Maps'])assert.ok(body.includes(text));
    assert.equal(await page.locator('input[aria-label="Find template market"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'Send emails',exact:true}).isDisabled(),true);
    for(const action of ['send','send-preview'])assert.equal((await context.request.post(base+'/api/research/'+action,{headers:{origin:base},data:{}})).status(),503);
    for(const width of [1280,876,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local-migration/research-live-preview.png',fullPage:true});
    for(const [path,heading,api] of [['/research/files','Incoming files','files'],['/research','Inbox','threads']]){
      const loaded=page.waitForResponse(r=>r.url()===base+'/api/research/'+api&&r.request().method()==='GET');
      await page.goto(base+path);await page.getByRole('heading',{name:heading,exact:true}).waitFor();
      const response=await loaded;assert.equal(response.status(),200);const data=await response.json();assert.equal(data.enabled,true);
      if(api==='files'){
        const groups=data.groups as {name:string;files:{id:string;name:string;state:string;sender:string;testUpload?:boolean}[]}[];
        const sections=page.locator('.research-file-market');await expect(sections).toHaveCount(groups.length);
        if(!groups.length)await expect(page.getByText('No files received yet.',{exact:true})).toBeVisible();
        for(const [i,group] of groups.entries()){
          const section=sections.nth(i);await expect(section.getByRole('heading',{level:2})).toHaveText(group.name);await expect(section.locator('.research-incoming-file')).toHaveCount(group.files.length);
          for(const file of group.files){
            await expect(section).toContainText(file.name);await expect(section).toContainText(file.sender);
            if(file.state==='ready')await expect(section.locator('a[href="/api/research/files/download?id='+file.id+'"]')).toHaveText(file.name);
          }
          if(group.files.some(f=>f.testUpload))await expect(section).toContainText('Test upload');
        }
      }else{
        const conversations=data.conversations as {id:string;subject:string;recipient:{name:string;firmName:string}}[];
        await expect(page.locator('.research-inbox tbody tr')).toHaveCount(conversations.length);
        if(!conversations.length)await expect(page.getByText('No research conversations yet.',{exact:true})).toBeVisible();
        for(const c of conversations){const link=page.locator('.research-inbox a[href="/research/'+c.id+'"]');await expect(link).toHaveText(c.subject);const row=page.getByRole('row').filter({has:link});await expect(row).toContainText(c.recipient.name);await expect(row).toContainText(c.recipient.firmName);}
      }
      assert.deepEqual(await unexpectedAlerts(page),[],path+' must have no application alerts');
    }
    const campaigns=await context.request.get(base+'/api/campaigns');assert.equal(campaigns.status(),200);assert.equal((await campaigns.json()).campaigns.length,4);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    fs.writeFileSync('.local-migration/research-runtime-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),base,success:true,radioCities:29,tvCities:32,canSave:true,canSend:false,campaigns:4,pageErrors:errors,externalRequests:external},null,2));
    console.log('PASS local app3000: login/auth, persistence enabled, template cities29/32, full email preview, no request market controls, send/preview-send blocked, responsive layout, incoming/inbox, four existing campaigns. No application data edited or real email sent.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
