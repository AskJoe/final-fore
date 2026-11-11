/** Approved local test data only; exercises the running app and real template persistence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';

async function main(){
  assert.equal(process.env.FINAL_FORE_APPROVED_LOCAL_RESEARCH_TEST,'1');
  assert.match(fs.readFileSync('.env.local','utf8'),/^FINAL_FORE_RESEARCH_SEND_ENABLED=0\s*$/m);
  const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1'}}));assert.equal(status.API_URL,'http://127.0.0.1:54321');
  const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  function checked<R extends {data:unknown;error:unknown}>(r:R):NonNullable<R['data']>{if(r.error)throw new Error(JSON.stringify(r.error));return r.data as NonNullable<R['data']>;}
  const before=checked(await admin.from('ff_records').select('*').order('id'));
  const runId=randomUUID(),email='drawer-'+runId+'@example.test',password=randomBytes(24).toString('hex'),base='http://127.0.0.1:3000';
  const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true}));assert.ok(user);
  let templateId:string|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    checked(await admin.from('ff_members').insert({user_id:user.id}));browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors:string[]=[],external:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'||!['3000','54321'].includes(url.port)){external.push(url.origin);return route.abort();}return route.continue();});
    await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    const copy=await context.request.post(base+'/api/research/templates/copy',{headers:{origin:base},data:{templateId:'radio-single-lincoln',revision:0}});assert.equal(copy.status(),200);const template=(await copy.json()).template;templateId=template.id;
    const name='Drawer verification '+runId;
    const save=await context.request.post(base+'/api/research/templates/save',{headers:{origin:base},data:{template:{...template,name},revision:template.revision}});assert.equal(save.status(),200);
    await page.goto(base+'/research/new');const row=page.getByRole('row').filter({hasText:'Jake Sorensen'});await row.getByRole('button',{name,exact:true}).click();
    const previewRowsBefore=checked(await admin.from('ff_research_previews').select('*').order('id'));
    const conversationRowsBefore=checked(await admin.from('ff_research_conversations').select('*').order('id'));
    const storedBefore=checked(await admin.from('ff_research_templates').select('*').eq('id',templateId).single());
    const drawer=page.getByRole('dialog',{name,exact:true});await expect(drawer).toBeVisible();
    const html=drawer.getByRole('tabpanel',{name:'HTML email',exact:true});await expect(html).toBeVisible();
    await expect(drawer.locator('input, textarea, form')).toHaveCount(0);
    for(const value of ['Hi Jake','Lincoln, NE','Weed Man Lawn Care','Sarah Silva','Station Coverage Maps','Market or Station Changes'])await expect(html).toContainText(value);
    for(const value of ['Due date needed','Flight dates needed','Radio trender books needed','Ranker books needed'])await expect(html.locator('mark').filter({hasText:value})).toBeVisible();
    assert.ok(!(await html.innerText()).includes('{{'));await expect(html.locator('p')).not.toHaveCount(0);await expect(html.locator('a')).toHaveCount(1);
    const uploadLink=html.getByRole('link');await expect(uploadLink).toHaveAttribute('target','_blank');
    const popupPromise=page.waitForEvent('popup');await uploadLink.click();const uploadPage=await popupPromise;await expect(uploadPage.getByRole('heading',{name:'Upload research',exact:true})).toBeVisible();await expect(uploadPage.getByRole('heading',{level:2})).toHaveText(['Lincoln, NE']);await expect(uploadPage.getByLabel('Upload files for Lincoln, NE')).toBeEnabled();await uploadPage.close();
    await drawer.getByRole('tab',{name:'Plain text',exact:true}).click();const plain=drawer.getByRole('tabpanel',{name:'Plain text email',exact:true});await expect(plain).toContainText('Lincoln, NE');await expect(plain).toContainText('[Due date needed]');assert.ok(!(await plain.innerText()).includes('{{'));
    assert.deepEqual(checked(await admin.from('ff_research_templates').select('*').eq('id',templateId).single()),storedBefore);
    for(const width of [1280,876,390]){await page.setViewportSize({width,height:900});assert.ok(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.setViewportSize({width:1280,height:900});await drawer.getByRole('tab',{name:'HTML',exact:true}).click();await page.screenshot({path:'.local-migration/research-drawer-live.png'});
    await drawer.getByRole('button',{name:'Close template preview',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(row.getByRole('checkbox',{name:'Send '+name+' to Jake Sorensen',exact:true})).not.toBeChecked();
    await page.getByLabel('Due date',{exact:true}).fill('2026-12-01');await row.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('tabpanel',{name:'HTML email',exact:true})).toContainText('2026-12-01');await expect(page.getByRole('tabpanel').locator('mark').filter({hasText:'Due date needed'})).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(checked(await admin.from('ff_research_templates').select('*').eq('id',templateId).single()),storedBefore);
    assert.deepEqual(checked(await admin.from('ff_research_previews').select('*').order('id')),previewRowsBefore);
    assert.deepEqual(checked(await admin.from('ff_research_conversations').select('*').order('id')),conversationRowsBefore);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS real local drawer: immediate per-record HTML without selecting send or filling a form, inline missing values, known values merged, plain text, clickable matching upload-page preview, no template writes, fixed Lincoln market, Close/Escape, responsive layout. No email sent.');
  }finally{
    await browser?.close();if(templateId){checked(await admin.from('ff_research_template_versions').delete().eq('template_id',templateId));checked(await admin.from('ff_research_templates').delete().eq('id',templateId));}
    checked(await admin.from('ff_members').delete().eq('user_id',user.id));checked(await admin.auth.admin.deleteUser(user.id));
    assert.deepEqual(checked(await admin.from('ff_records').select('*').order('id')),before);console.log('PASS drawer test data cleaned; existing application records unchanged.');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
