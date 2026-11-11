import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
const phase=process.argv[2];assert.ok(['before','after'].includes(phase));
const status=JSON.parse(fs.readFileSync('.local-migration/local-supabase-status.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(fs.readFileSync('.env.local','utf8'),/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321$/m);
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const baselineFile='.local-migration/persistence-baseline-current.json';
if(phase==='before'){
 const current=await admin.from('ff_records').select('*').order('id');if(current.error)throw current.error;
 assert.ok(current.data.length>0);
 const stamp=new Date().toISOString().replaceAll(':','-');
 for(const previous of [baselineFile,'.local-migration/persistence-proof.json'])if(fs.existsSync(previous))fs.copyFileSync(previous,`.local-migration/backups/${previous.split('/').at(-1)}-${stamp}`);
 fs.writeFileSync(baselineFile,JSON.stringify(current.data),{mode:0o600});
}
const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
const record=baseline.find(r=>r.kind==='campaign');assert.ok(record);
const file='.local-migration/persistence-proof.json';
const proof=phase==='before'?{id:record.payload.id,recordId:record.id,originalName:record.payload.name,marker:'Local persistence verification '+new Date().toISOString(),before:record.payload.revision}:JSON.parse(fs.readFileSync(file,'utf8'));
const container=JSON.parse(execFileSync('docker',['--context','desktop-linux','inspect','supabase_db_final-fore-local'],{encoding:'utf8'}))[0];
const runtime={containerId:container.Id,volume:container.Mounts.find(m=>m.Destination==='/var/lib/postgresql/data')?.Name,appPid:execFileSync('lsof',['-t','-iTCP:3107','-sTCP:LISTEN'],{encoding:'utf8'}).trim()};
assert.equal(runtime.volume,'supabase_db_final-fore-local');
proof[phase==='before'?'runtimeBefore':'runtimeAfter']=runtime;
if(phase==='after'){
 assert.notEqual(runtime.containerId,proof.runtimeBefore.containerId,'Database container must have restarted');
 assert.notEqual(runtime.appPid,proof.runtimeBefore.appPid,'App process must have restarted');
 assert.equal(runtime.volume,proof.runtimeBefore.volume);
}
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext();const page=await context.newPage();
 await page.goto('http://127.0.0.1:3107/login');await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password').fill('local-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
 await page.goto('http://127.0.0.1:3107/campaign.html?id='+encodeURIComponent(proof.id));await page.locator('#campaign-main').waitFor({state:'visible'});
 assert.equal(await page.locator('#campaign-name').inputValue(),phase==='before'?proof.originalName:proof.marker);
 if(phase==='after'){proof.survivedRestart=true;proof.readAfterRestartAt=new Date().toISOString();console.log('PASS: saved campaign name survived the app and Supabase restart.');}
 const target=phase==='before'?proof.marker:proof.originalName;
 const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/campaign'&&r.request().method()==='POST');
 await page.locator('#campaign-name').fill(target);await page.locator('#campaign-name').press('Tab');
 const response=await responsePromise;assert.equal(response.status(),200,await response.text());const saved=await response.json();assert.equal(saved.details.name,target);
 const stored=await admin.from('ff_records').select('*').eq('id',proof.recordId).single();if(stored.error)throw stored.error;
 assert.equal(stored.data.payload.name,target);assert.equal(stored.data.payload.revision,saved.details.revision);
 proof[phase==='before'?'savedRevision':'restoredRevision']=saved.details.revision;
 proof[phase==='before'?'savedVersion':'restoredVersion']=stored.data.version;
 proof[phase==='before'?'savedAt':'restoredAt']=new Date().toISOString();
 fs.writeFileSync(file,JSON.stringify(proof,null,2),{mode:0o600});
 console.log(JSON.stringify({phase,recordId:proof.recordId,name:target,revision:saved.details.revision,postgresVersion:stored.data.version,writeVerifiedInPostgres:true},null,2));
 if(phase==='after'){
  const all=await admin.from('ff_records').select('*');if(all.error)throw all.error;assert.equal(all.data.length,baseline.length);
  for(const source of baseline){const current=all.data.find(r=>r.id===source.id);assert.ok(current);const payload=structuredClone(current.payload);if(source.id===proof.recordId)payload.revision=source.payload.revision;else assert.deepEqual(current,source);assert.deepEqual(payload,source.payload);}
  proof.allOriginalValuesRestored=true;proof.recordCount=all.data.length;fs.writeFileSync(file,JSON.stringify(proof,null,2),{mode:0o600});console.log(`PASS: all ${all.data.length} current payloads preserved; only verification campaign revisions/timestamps advanced.`);
 }
}finally{await browser.close();}
