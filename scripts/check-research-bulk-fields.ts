/** Uses only approved temporary local fixtures; never sends email or edits source templates. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium,expect} from '@playwright/test';
import type { TemplateDraft } from '../lib/research/types';
async function main(){
  assert.equal(process.env.FINAL_FORE_APPROVED_LOCAL_RESEARCH_TEST,'1');
  assert.match(fs.readFileSync('.env.local','utf8'),/^FINAL_FORE_RESEARCH_SEND_ENABLED=0\s*$/m);
  const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1'}}));assert.equal(status.API_URL,'http://127.0.0.1:54321');
  const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  function checked<R extends {data:unknown;error:unknown}>(r:R):NonNullable<R['data']>{if(r.error)throw new Error(JSON.stringify(r.error));return r.data as NonNullable<R['data']>;}
  const before=checked(await admin.from('ff_records').select('*').order('id')),templatesBefore=checked(await admin.from('ff_research_templates').select('*').order('id'));
  const runId=randomUUID(),email='bulk-'+runId+'@example.test',password=randomBytes(24).toString('hex'),base='http://127.0.0.1:3000';
  const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true}));assert.ok(user);
  const ids:string[]=[];let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    checked(await admin.from('ff_members').insert({user_id:user.id}));browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors:string[]=[],external:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'||!['3000','54321'].includes(url.port)){external.push(url.origin);return route.abort();}return route.continue();});
    await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
    const workspace=await (await context.request.get(base+'/api/research/workspace')).json();assert.equal(workspace.canSend,false);
    const source=workspace.templates.find((t:{id:string})=>t.id==='radio-single-lincoln'),copies:TemplateDraft[]=[];
    for(let n=0;n<2;n++){const response=await context.request.post(base+'/api/research/templates/copy',{headers:{origin:base},data:{templateId:source.id,revision:source.revision}});assert.equal(response.status(),200);const copy=(await response.json()).template;ids.push(copy.id);
      const save=await context.request.post(base+'/api/research/templates/save',{headers:{origin:base},data:{template:{...copy,name:`Bulk ${n} ${runId}`,defaults:{...copy.defaults,ranker_books:`Keep ${n}`}},revision:copy.revision}});assert.equal(save.status(),200);copies.push((await save.json()).template);}
    await page.goto(base+'/research/new');await expect(page.getByRole('button',{name:'Edit fields',exact:true})).toBeDisabled();const row=page.getByRole('row').filter({hasText:'Jake Sorensen'});
    for(const copy of copies)await row.getByRole('checkbox',{name:'Send '+copy.name+' to Jake Sorensen',exact:true}).check();
    await page.getByRole('button',{name:'Edit fields',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit fields',exact:true});await expect(dialog).toContainText('2 shared templates');await expect(dialog.getByLabel('Ranker books',{exact:true})).toHaveAttribute('placeholder','Mixed values — unchanged');
    await dialog.getByLabel('Due date',{exact:true}).fill('2026-12-01');await dialog.getByLabel('Flight dates',{exact:true}).fill('March–May 2027');await dialog.getByLabel('Radio trender books',{exact:true}).fill('Spring 2026');
    for(const width of [1280,876,390]){await page.setViewportSize({width,height:900});assert.ok(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return el.scrollWidth<=el.clientWidth+1&&r.left>=0&&r.right<=innerWidth+1;}));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await page.screenshot({path:'.local-migration/research-bulk-fields-live.png'});await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Due date',{exact:true})).toHaveValue('2026-12-01');
    for(let n=0;n<copies.length;n++){const stored:TemplateDraft=checked(await admin.from('ff_research_templates').select('payload').eq('id',copies[n].id).single()).payload;assert.equal(stored.defaults.flight_dates,'March–May 2027');assert.equal(stored.defaults.radio_trender_books,'Spring 2026');assert.equal(stored.defaults.ranker_books,'Keep '+n);assert.deepEqual(stored.markets,copies[n].markets);
      await row.getByRole('button',{name:copies[n].name,exact:true}).click();const html=page.getByRole('tabpanel',{name:'HTML email',exact:true});await expect(html).toContainText('March–May 2027');await expect(html).toContainText('2026-12-01');await expect(html).toContainText('Keep '+n);await page.keyboard.press('Escape');}
    // A stale batch rejects before writing even its otherwise valid first template.
    const fresh=(await (await context.request.get(base+'/api/research/workspace')).json()).templates.filter((t:{id:string})=>ids.includes(t.id));
    const refs=fresh.map((t:{id:string;revision:number},i:number)=>({id:t.id,revision:i?0:t.revision}));
    const stale=await context.request.post(base+'/api/research/templates/bulk-fields',{headers:{origin:base},data:{templates:refs,fields:{flight_dates:'Must not save'}}});assert.equal(stale.status(),409);
    for(const id of ids)assert.equal(checked(await admin.from('ff_research_templates').select('payload').eq('id',id).single()).payload.defaults.flight_dates,'March–May 2027');
    await page.getByRole('button',{name:'Edit fields',exact:true}).click();await dialog.getByLabel('Flight dates',{exact:true}).fill('Cancel me');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS real local bulk edit: two checked templates, shared-variable saves, selected-send due date, mixed values preserved, markets unchanged, immediate merged previews, stale batch rejection, Cancel, responsive layout. No email sent.');
  }finally{await browser?.close();for(const id of ids){checked(await admin.from('ff_research_template_versions').delete().eq('template_id',id));checked(await admin.from('ff_research_templates').delete().eq('id',id));}checked(await admin.from('ff_members').delete().eq('user_id',user.id));checked(await admin.auth.admin.deleteUser(user.id));assert.deepEqual(checked(await admin.from('ff_records').select('*').order('id')),before);assert.deepEqual(checked(await admin.from('ff_research_templates').select('*').order('id')),templatesBefore);console.log('PASS bulk fixture cleanup; source templates and application records unchanged.');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
