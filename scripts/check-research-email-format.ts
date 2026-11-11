/** No database, email, or network writes: render all four source formats for visual QA. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {sourceTemplates} from '../lib/research/templates';
import {renderEmail} from '../lib/research/render';
import type {Recipient} from '../lib/research/types';
async function main(){
  const dir='.local-migration/template-format-review';fs.mkdirSync(dir,{recursive:true});const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:950,height:1000}}),external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort();});
    for(const t of sourceTemplates()){
      const rep:Recipient={repId:'review',templateId:t.id,firmId:'review',firmName:'Example firm',name:'Example Rep',to:'rep@example.test',cc:[]};
      const email=renderEmail(t,rep,{deadline:'2026-11-13',flight_dates:'Feb-May ’27',radio_trender_books:'Feb ’26 through Sept ‘26',ranker_books:"Mar ‘26, July '26 AND Sept '26",tv_books:'Mar ’26, Jul ‘26 & Sept ‘26',avail_book:'Mar ‘26'},'https://example.test/upload');
      await page.setViewportSize({width:950,height:1000});await page.setContent('<html><head><meta charset="utf-8"></head><body style="padding:28px;margin:0">'+email.html+'</body></html>');
      await expect(page.locator('ol > li')).toHaveCount(6);
      for(const el of await page.locator('ul').all())assert.equal(await el.evaluate(n=>getComputedStyle(n).listStyleType),'circle');
      await expect(page.locator('ol')).toContainText('Station Coverage Maps');await expect(page.locator('ol')).toContainText('Market or Station Changes');
      assert.ok(await page.locator('strong').count()>5);assert.ok(await page.locator('em').count()>0);assert.ok(await page.locator('u').count()>0);
      await page.screenshot({path:dir+'/'+t.id+'-full.png',fullPage:true});await page.locator('ol').screenshot({path:dir+'/'+t.id+'-sections.png'});
      for(const width of [876,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
      // The formatted email in the provider payload is self-contained, without app stylesheets.
      fs.writeFileSync(dir+'/'+t.id+'.html','<!doctype html><meta charset="utf-8">'+email.html);fs.writeFileSync(dir+'/'+t.id+'.txt',email.text);
    }
    assert.deepEqual(external,[]);console.log('PASS four source email formats: six ordered sections each, nested circle bullets, bold/italic/underline, self-contained HTML, desktop/mobile overflow checks. No database writes, external requests or email.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
