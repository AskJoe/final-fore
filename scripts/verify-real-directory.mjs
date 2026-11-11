// Explicitly authorized local-only directory save verification. No dummy records.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const base='http://127.0.0.1:3107';
const status=JSON.parse(fs.readFileSync('.local-migration/local-supabase-status.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(fs.readFileSync('.env.local','utf8'),/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321$/m);
const authOptions={auth:{persistSession:false,autoRefreshToken:false}};
const db=createClient(status.API_URL,status.PUBLISHABLE_KEY,authOptions);
const login=await db.auth.signInWithPassword({email:'owner@example.test',password:'local-test-password'});
if(login.error)throw login.error;
const readStored=async()=>{const result=await db.from('ff_records').select('*').eq('id','directory').maybeSingle();if(result.error)throw result.error;return result.data;};
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/login');await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password').fill('local-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
  const read=async()=>{const response=await context.request.get(base+'/api/directory');assert.equal(response.status(),200);return response.json();};
  const initial=await read(),beforeStored=await readStored();
  fs.writeFileSync('.local-migration/directory-before-verification.json',JSON.stringify({initial,beforeStored},null,2),{mode:0o600});
  const rep=initial.directory.reps.find(row=>row.active&&row.coverage.length<=2);
  assert.ok(rep);
  const targets=[
    ['clients',initial.directory.clients.find(row=>row.id==='epic3'),'/clients.html'],
    ['firms',initial.directory.firms.find(row=>row.id===rep.firmId),'/vendors.html'],
    ['reps',rep,'/vendors.html?view=reps'],
    ['stations',initial.directory.stations.find(row=>row.active),'/vendors.html?view=stations'],
  ];
  const save=async()=>{const response=page.waitForResponse(r=>r.url()===base+'/api/directory/entity'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save',exact:true}).click();const result=await response;assert.equal(result.status(),200,await result.text());await expect(page.locator('#record-dialog')).toBeHidden();};
  for(const [collection,original,path] of targets){
    assert.ok(original);const before=await read(),marker='Local save verification '+new Date().toISOString(),notes=original.notes+(original.notes?'\n':'')+marker;
    await page.goto(base+path);await expect(page.locator('#add-record')).toBeEnabled();await page.locator('#search').fill(original.name);
    await page.getByRole('button',{name:'Edit '+original.name,exact:true}).click();await page.getByLabel('Notes',{exact:true}).fill(notes);await save();
    const persisted=await readStored();assert.equal(persisted.version,before.revision+1);assert.deepEqual(persisted.payload[collection].find(row=>row.id===original.id),{...original,notes});
    await page.reload();await expect(page.locator('#add-record')).toBeEnabled();await page.locator('#search').fill(original.name);await page.getByRole('button',{name:'Edit '+original.name,exact:true}).click();await expect(page.getByLabel('Notes',{exact:true})).toHaveValue(notes);
    await page.getByLabel('Notes',{exact:true}).fill(original.notes);await save();
    const restored=await readStored();assert.equal(restored.version,persisted.version+1);assert.deepEqual(restored.payload,initial.directory);
    await page.reload();await expect(page.locator('#add-record')).toBeEnabled();assert.equal((await read()).referenceOnly,false);
    results.push({collection,id:original.id,saveVersion:persisted.version,restoreVersion:restored.version,restored:true});
    console.log('PASS '+collection+' UI save, PostgreSQL persistence, reload, and original-value restoration');
  }
  const final=await readStored();
  const stale=await db.rpc('ff_save_record',{p_id:'directory',p_kind:'directory',p_payload:final.payload,p_expected_version:final.version-1});
  assert.equal(stale.status,409);assert.equal(stale.error?.code,'PT409');assert.deepEqual(await readStored(),final);
  console.log('PASS real directory stale-save rejection: HTTP 409 / PT409; stored record unchanged');
  const crossOrigin=await context.request.post(base+'/api/directory/entity',{headers:{origin:'https://other.example'},data:{collection:'clients',entity:initial.directory.clients[0],revision:final.version}});
  assert.equal(crossOrigin.status(),403);assert.deepEqual(await readStored(),final);
  const anon=createClient(status.API_URL,status.PUBLISHABLE_KEY,authOptions),denied=await anon.from('ff_records').select('id').eq('id','directory');
  assert.equal(denied.error?.code,'42501');assert.equal(denied.data,null);
  const anonymousContext=await browser.newContext();const anonymousApi=await anonymousContext.request.get(base+'/api/directory');assert.equal(anonymousApi.status(),401);await anonymousContext.close();
  console.log('PASS cross-origin writes denied (403), anonymous API denied (401), anonymous database reads denied (42501)');
  assert.deepEqual(errors,[]);assert.deepEqual(final.payload,initial.directory);
  await page.goto(base+'/clients.html');await expect(page.locator('#add-record')).toBeEnabled();await expect(page.locator('#status')).not.toContainText('not yet saved');await page.screenshot({path:'.local-migration/real-directory-clients.png'});
  await page.goto(base+'/vendors.html');await expect(page.locator('#add-record')).toBeEnabled();await expect(page.locator('#status')).not.toContainText('not yet saved');await page.screenshot({path:'.local-migration/real-directory-vendors.png'});
  fs.writeFileSync('.local-migration/real-directory-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),results,recordVersion:final.version,referencePersisted:true,originalDirectoryValuesPreserved:true,counts:Object.fromEntries(Object.entries(final.payload).map(([key,rows])=>[key,rows.length])),staleSaveRejected:true,crossOriginDenied:true,anonymousDenied:true,errors},null,2),{mode:0o600});
  console.log('PASS original directory values preserved; no test entries added; zero browser runtime errors');
} finally {await browser.close();}
