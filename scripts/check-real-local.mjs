import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
assert.match(fs.readFileSync('.env.local','utf8'),/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321$/m);
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3107/login');await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password').fill('local-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/index.html');
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved to Supabase');
 const counts=await page.evaluate(async()=>{
  const result={};for(const [name,url] of [['workbook','/api/table'],['campaigns','/api/campaigns'],['reporting','/reporting-data.json']]){const r=await fetch(url);if(!r.ok)throw Error(url+': '+r.status);const d=await r.json();result[name]=name==='workbook'?Object.keys(d.cells).length:name==='campaigns'?d.campaigns.length:d.records.length;}return result;
 });
 assert.equal(counts.campaigns,4);assert.equal(counts.reporting,72410);
 for(const path of ['/markets.html','/markets.html#variables','/campaign.html','/legacy-orders.html','/orders.html']){await page.goto('http://127.0.0.1:3107'+path);await page.waitForLoadState('networkidle');assert.equal(await page.locator('#message:visible').count(),0,path);console.log('PASS real local '+path);}
 for(const path of ['/data.html','/dashboard.html']){await page.goto('http://127.0.0.1:3107'+path);await page.waitForFunction(()=>document.querySelector('#freshness')?.textContent?.includes('Through'));assert.equal(await page.locator('#load-state:visible').count(),0);console.log('PASS real local '+path);}
 assert.deepEqual(errors,[]);await page.screenshot({path:'.local-migration/real-local-dashboard.png',fullPage:true});
 fs.writeFileSync('.local-migration/real-local-screen-checks.json',JSON.stringify({verifiedAt:new Date().toISOString(),counts,screenRoutes:7,errors,backend:'real local Supabase/PostgreSQL'},null,2));
 console.log(JSON.stringify({counts,screenRoutes:7,errors},null,2));
}finally{await browser.close();}
