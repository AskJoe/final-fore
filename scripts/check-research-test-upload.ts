/** Approved local integration: only this run's temporary user, collection and files are cleaned. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium,expect} from '@playwright/test';
async function main(){
 assert.equal(process.env.FINAL_FORE_APPROVED_LOCAL_RESEARCH_TEST,'1');assert.match(fs.readFileSync('.env.local','utf8'),/^FINAL_FORE_RESEARCH_SEND_ENABLED=0\s*$/m);
 const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1'}}));assert.equal(status.API_URL,'http://127.0.0.1:54321');
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 function checked<R extends {data:unknown;error:unknown}>(r:R):NonNullable<R['data']>{if(r.error)throw new Error(JSON.stringify(r.error));return r.data as NonNullable<R['data']>;}
 const before=checked(await admin.from('ff_records').select('*').order('id')),deliveries=checked(await admin.from('ff_research_deliveries').select('id').order('id'));
 const runId=randomUUID(),email='upload-test-'+runId+'@example.test',password=randomBytes(24).toString('hex'),base='http://127.0.0.1:3000';
 const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true}));assert.ok(user);
 const browser=await chromium.launch({headless:true});
 try{
  checked(await admin.from('ff_members').insert({user_id:user.id}));const context=await browser.newContext(),page=await context.newPage(),external:string[]=[],errors:string[]=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'||!['3000','54321'].includes(u.port)){external.push(u.origin);return route.abort();}return route.continue();});
  assert.equal((await context.request.post(base+'/api/research/upload-test',{headers:{origin:base},data:{templateId:'tv-multi',repId:'x',deadline:''}})).status(),401);
  await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
  const workspace=await (await context.request.get(base+'/api/research/workspace')).json(),rep=workspace.reps.find((r:{name:string})=>r.name==='John Wahlert'),template=workspace.templates.find((t:{id:string})=>t.id==='tv-multi');
  const market=template.markets.find((m:{marketId:string|null})=>m.marketId),unlinked=template.markets.find((m:{marketId:string|null})=>!m.marketId);assert.ok(market);
  await page.goto(base+'/research/new');await page.getByRole('row').filter({hasText:'John Wahlert'}).getByRole('button',{name:template.name,exact:true}).click();
  const popup=page.waitForEvent('popup');await page.getByRole('tabpanel',{name:'HTML email',exact:true}).getByRole('link').click();const portal=await popup;
  await expect(portal.getByLabel('Upload files for '+market.displayName)).toBeEnabled();if(unlinked)await expect(portal.getByLabel('Upload files for '+unlinked.displayName)).toBeDisabled();
  assert.equal(checked(await admin.from('ff_research_conversations').select('id').eq('created_by',user.id)).length,0);
  const incoming=await context.newPage();await incoming.goto(base+'/research/files');
  const files=[{name:'test-'+runId+'.txt',mimeType:'text/plain',buffer:Buffer.from('Preview upload test '+runId)},{name:'test-'+runId+'.csv',mimeType:'text/csv',buffer:Buffer.from('market,value\n'+market.displayName+',1\n')}];
  await portal.getByLabel('Upload files for '+market.displayName).setInputFiles(files);
  for(const file of files){
    await expect(portal.getByRole('link',{name:file.name,exact:true})).toBeVisible({timeout:30000});
    await expect(incoming.getByRole('link',{name:file.name,exact:true})).toBeVisible({timeout:30000});
    for(const view of [portal,incoming]){const href=await view.getByRole('link',{name:file.name,exact:true}).getAttribute('href');assert.ok(href);const opened=await context.request.get(base+href);assert.equal(opened.status(),200);assert.deepEqual(await opened.body(),file.buffer);}
  }
  const rows=checked(await admin.from('ff_research_conversations').select('*').eq('created_by',user.id));assert.equal(rows.length,1);assert.equal(rows[0].mode,'preview');assert.equal(rows[0].template_version_id,null);assert.deepEqual(rows[0].manifest.markets,template.markets.filter((m:{marketId:string|null})=>m.marketId));
  const stored=checked(await admin.from('ff_research_files').select('*').eq('conversation_id',rows[0].id));assert.equal(stored.length,2);
  for(const file of stored){assert.equal(file.market_id,market.marketId);assert.equal(file.state,'ready');const blob=checked(await admin.storage.from('research-files').download(file.object_key));assert.deepEqual(Buffer.from(await blob.arrayBuffer()),files.find(f=>f.name===file.name)!.buffer);}
  const section=incoming.locator('.research-file-market').filter({hasText:files[0].name});await expect(section.getByRole('heading',{level:2})).toHaveText(market.displayName);const senderGroup=section.locator('.research-sender-files').filter({hasText:files[0].name});await expect(senderGroup).toHaveCount(1);await expect(senderGroup.getByText('Test upload',{exact:true})).toBeVisible();await expect(senderGroup.locator('.research-sender')).toContainText('John Wahlert');
  await portal.reload();for(const file of files)await expect(portal.getByText(file.name,{exact:true})).toBeVisible();await expect(portal.getByText('2 files received',{exact:true})).toBeVisible();const duplicateReservation=portal.waitForResponse(r=>r.url().endsWith('/api/research-upload/reserve')&&r.request().method()==='POST');await portal.getByLabel('Upload files for '+market.displayName).setInputFiles(files[0]);const duplicateResult=await duplicateReservation;assert.equal(duplicateResult.status(),200);assert.equal((await duplicateResult.json()).grant,null);
  await expect(portal.getByText(files[0].name,{exact:true})).toHaveCount(1);assert.equal(checked(await admin.from('ff_research_files').select('id').eq('conversation_id',rows[0].id)).length,2);
  const payload={templateId:template.id,repId:rep.id,deadline:''};const repeated=await Promise.all([1,2].map(()=>context.request.post(base+'/api/research/upload-test',{headers:{origin:base},data:payload})));const sessions=await Promise.all(repeated.map(r=>r.json()));assert.equal(sessions[0].conversationId,rows[0].id);assert.equal(sessions[0].token,sessions[1].token);
  assert.equal((await context.request.post(base+'/api/research/upload-test',{headers:{origin:base},data:{...payload,markets:['wrong']}})).status(),400);
  assert.equal((await context.request.post(base+'/api/research-upload/reserve',{headers:{origin:base},data:{token:sessions[0].token,file:{marketId:'wrong',name:'wrong.txt',size:1,sha256:'a'.repeat(64)}}})).status(),400);
  // A failed request gives an explicit Retry control; no page reload is required.
  const retried={name:'retry-'+runId+'.txt',mimeType:'text/plain',buffer:Buffer.from('Retry without reload.')};let failOnce=true;
  await portal.route('**/api/research-upload/reserve',route=>{const data=route.request().postDataJSON();if(failOnce&&data.file?.name===retried.name){failOnce=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary upload failure. Retry this file.'})});}return route.continue();});
  await portal.getByLabel('Upload files for '+market.displayName).setInputFiles(retried);
  const failed=portal.locator('.rep-file').filter({hasText:retried.name});await expect(failed).toContainText('Temporary upload failure');await failed.getByRole('button',{name:'Retry',exact:true}).click();await expect(portal.getByRole('link',{name:retried.name,exact:true})).toBeVisible({timeout:30000});
  // If finalization never reaches the server, polling recovers the stored bytes automatically.
  let dropFinalize=true;await portal.route('**/api/research-upload/finalize',route=>{if(dropFinalize){dropFinalize=false;return route.abort('failed');}return route.continue();});
  const recovered={name:'recover-'+runId+'.txt',mimeType:'text/plain',buffer:Buffer.from('Stored file recovers without reload.')};
  await portal.getByLabel('Upload files for '+market.displayName).setInputFiles(recovered);await expect(portal.getByRole('link',{name:recovered.name,exact:true})).toBeVisible({timeout:30000});
  await expect(incoming.getByRole('link',{name:recovered.name,exact:true})).toBeVisible({timeout:30000});
  const invalid={name:'invalid-'+runId+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('This is not a PDF.')};await portal.getByLabel('Upload files for '+market.displayName).setInputFiles(invalid);
  const rejected=portal.locator('.rep-file').filter({hasText:invalid.name});await expect(rejected).toContainText('Please choose a valid document and upload it again.',{timeout:30000});await expect(rejected.getByRole('link')).toHaveCount(0);
  const invalidRow=checked(await admin.from('ff_research_files').select('id,state').eq('conversation_id',rows[0].id).eq('name',invalid.name).single());assert.equal(invalidRow.state,'held');assert.equal((await context.request.get(base+'/research-upload/'+sessions[0].token+'/files/'+invalidRow.id)).status(),404);
  assert.equal(checked(await admin.from('ff_research_messages').select('id').eq('conversation_id',rows[0].id)).length,0);assert.deepEqual(checked(await admin.from('ff_research_deliveries').select('id').order('id')),deliveries);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await incoming.screenshot({path:'.local-migration/test-upload-incoming.png'});
  console.log('PASS local preview uploads: enabled linked markets, unresolved disabled, two real signed uploads, exact stored bytes and market IDs, live incoming Test upload label and sender, reload/reuse, duplicate suppression, anonymous and wrong-market rejection, zero messages/deliveries. Automatic rep/internal openable links with exact bytes, explicit failure and Retry, lost-finalize recovery without reload, and invalid-document rejection. Trusted document flow uses no antivirus dependency.');
 }finally{
  await browser.close();const rows=checked(await admin.from('ff_research_conversations').select('id').eq('created_by',user.id)),ids=rows.map(r=>r.id);
  if(ids.length){const files=checked(await admin.from('ff_research_files').select('id,object_key').in('conversation_id',ids));if(files.length){checked(await admin.storage.from('research-files').remove(files.map(f=>f.object_key)));checked(await admin.from('ff_research_jobs').delete().in('operation_key',files.map(f=>'verify-file:'+f.id)));checked(await admin.from('ff_research_files').delete().in('conversation_id',ids));}checked(await admin.from('ff_research_secrets').delete().in('conversation_id',ids));checked(await admin.from('ff_research_conversations').delete().in('id',ids));}
  checked(await admin.from('ff_members').delete().eq('user_id',user.id));checked(await admin.auth.admin.deleteUser(user.id));assert.deepEqual(checked(await admin.from('ff_records').select('*').order('id')),before);console.log('PASS only own test data cleaned; existing records unchanged.');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
