import assert from 'node:assert/strict';
import { expect, type Page, type BrowserContext } from '@playwright/test';
import { browserOrders } from '../tests/mock-unified-orders';

// Run inside check-local's existing, in-memory Supabase fixture. No real DB writes.
export async function checkDirectory(page:Page,context:BrowserContext,base:string,pass:(label:string)=>void) {
  const read=async()=>{const r=await context.request.get(base+'/api/directory');assert.equal(r.status(),200);return r.json();};
  const saveDialog=async()=>{const response=page.waitForResponse(r=>r.url()===base+'/api/directory/entity'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save',exact:true}).click();const r=await response;assert.equal(r.status(),200,await r.text());await expect(page.locator('#record-dialog')).not.toBeVisible();await page.waitForLoadState('networkidle');};
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/clients.html');await expect(page.getByRole('button',{name:'Add client',exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'Clients',exact:true})).toBeVisible();
  await expect(page.locator('#table-body')).toContainText('Epic3');await expect(page.locator('#table-body')).toContainText('Weed Man');await expect(page.locator('#table-body')).toContainText('34 franchise markets');
  await expect(page.getByRole('link',{name:'Clients',exact:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:'.local-migration/clients-desktop.png',fullPage:true});
  pass('clients distinguish Epic3, Weed Man brand and 34 franchise markets');
  await page.getByRole('button',{name:'Add client',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Browser Test Client');await page.getByLabel('Franchise brand',{exact:true}).fill('Test Brand');await saveDialog();
  let data=await read();const client=data.directory.clients.find((r:any)=>r.name==='Browser Test Client');assert.ok(client);assert.equal(client.brand,'Test Brand');assert.equal(data.referenceOnly,false);
  await page.reload();await expect(page.locator('#table-body')).toContainText('Browser Test Client');
  pass('new client saves through the UI and survives reload in isolated storage');
  await page.goto(base+'/vendors.html');await expect(page.getByRole('button',{name:'Add firm',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Add firm',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Browser Test Vendor');await page.getByLabel('Firm roles',{exact:true}).selectOption(['direct-vendor']);await saveDialog();
  data=await read();const firm=data.directory.firms.find((r:any)=>r.name==='Browser Test Vendor');assert.ok(firm);
  await page.goto(base+'/vendors.html?view=reps');await expect(page.getByRole('button',{name:'Add rep',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Add rep',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Browser Test Rep');await page.getByLabel('Firm',{exact:true}).selectOption(firm.id);await page.getByLabel('Email',{exact:true}).fill('rep@example.test');
  await page.getByRole('button',{name:'Add coverage',exact:true}).click();await page.getByLabel('Media type',{exact:true}).selectOption('digital');await page.getByLabel('Channel (optional)',{exact:true}).selectOption('r8');await page.getByLabel('Market / territory (optional)',{exact:true}).fill('Test market');await saveDialog();
  data=await read();const rep=data.directory.reps.find((r:any)=>r.name==='Browser Test Rep');assert.ok(rep);assert.equal(rep.firmId,firm.id);assert.equal(rep.coverage[0].channelId,'r8');
  await page.locator('#search').fill('Browser Test Rep');await expect(page.locator('#table-body')).toContainText('Browser Test Vendor');await expect(page.locator('#table-body')).toContainText('iHeart Streaming Radio/Audio');
  await page.screenshot({path:'.local-migration/vendor-rep-desktop.png',fullPage:true});
  pass('firm and rep creation retain digital channel and territory coverage');
  const staleRevision=data.revision;
  await page.getByRole('button',{name:'Edit Browser Test Rep',exact:true}).click();await page.getByLabel('Phone',{exact:true}).fill('555-0100');await saveDialog();
  const stale=await context.request.post(base+'/api/directory/entity',{headers:{origin:base},data:{collection:'reps',entity:rep,revision:staleRevision}});assert.equal(stale.status(),409);
  const crossOrigin=await context.request.post(base+'/api/directory/entity',{headers:{origin:'https://other.example'},data:{collection:'reps',entity:rep,revision:staleRevision}});assert.equal(crossOrigin.status(),403);
  data=await read();assert.equal(data.directory.reps.find((r:any)=>r.id===rep.id).phone,'555-0100');
  pass('directory edits persist and stale or cross-origin saves cannot overwrite them');
  await page.goto(base+'/vendors.html?view=stations');await expect(page.getByRole('button',{name:'Add station / property',exact:true})).toBeEnabled();await page.locator('#search').fill('KTAB');await expect(page.locator('#table-body')).toContainText('Nexstar');await expect(page.locator('#table-body')).toContainText('Katz TV');
  await page.getByRole('button',{name:'Add station / property',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('TEST-FM');await page.getByLabel('Media type',{exact:true}).selectOption('broadcast-radio');await page.getByLabel('Market',{exact:true}).fill('Test market');await page.getByLabel('Owner firm',{exact:true}).selectOption(firm.id);await page.getByLabel('Rep firm',{exact:true}).selectOption(firm.id);await saveDialog();
  data=await read();assert.ok(data.directory.stations.some((s:any)=>s.name==='TEST-FM'&&s.mediaType==='broadcast-radio'));
  pass('station owners remain separate from rep firms; radio station creation saves');
  await page.goto(base+'/campaign.html');await expect(page.locator('#campaign-main')).toBeVisible();await expect(page.locator('#client')).toHaveValue('epic3');await expect(page.locator('#client-brand')).toHaveValue('Weed Man');await expect(page.locator('#client option').filter({hasText:'Browser Test Client'})).toHaveCount(1);
  pass('campaign client picker reads the directory and displays the franchise brand');
  const catalog=await (await context.request.get(base+'/api/campaign/catalog')).json();
  const campaign={...catalog.draft.details,workflow:'broadcast',name:'Browser Test Campaign',clientId:client.id,budget:100000,start:'2027-03-01',end:'2027-03-28',markets:[]};
  const created=await context.request.post(base+'/api/campaign',{headers:{origin:base},data:campaign});assert.equal(created.status(),200,await created.text());const savedCampaign=await created.json();
  await page.goto(base+'/campaign.html?workflow=broadcast&id='+encodeURIComponent(savedCampaign.details.id));
  await expect(page.locator('#client')).toHaveValue(client.id);
  await expect(page.locator('#client-brand')).toHaveValue('Test Brand');
  const {clientId,year,campaignId,marketId}=browserOrders;
  const orderUrl=base+'/campaign/orders?'+new URLSearchParams({clientId,year:String(year),campaignId,marketId,section:'digital'});
  await page.goto(orderUrl);
  await expect(page.getByRole('region',{name:'Digital placements',exact:true}).getByText('Editing',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Order details',exact:true}).click();
  for(const [label,value] of [['Media Vendor',firm.name],['Representative',rep.name]]){
    await page.getByRole('button',{name:'Edit '+label,exact:true}).click();
    const input=page.getByRole('textbox',{name:label,exact:true});
    await input.fill(value);await input.press('Enter');
  }
  await expect(page.getByText('Draft saved',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region',{name:'Digital placements',exact:true}).getByText('Editing',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Order details',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit Media Vendor',exact:true})).toHaveText(firm.name);
  await expect(page.getByRole('button',{name:'Edit Representative',exact:true})).toHaveText(rep.name);
  await page.getByRole('button',{name:'Print order',exact:true}).click();
  const preview=page.frameLocator('iframe[title="Draft media order"]');
  await expect(preview.getByText('Evening news',{exact:true}).first()).toBeVisible();
  await expect(preview.getByText('Streaming audio',{exact:true}).first()).toBeVisible();
  await page.getByRole('dialog',{name:'Print preview'}).getByRole('button',{name:'Close',exact:true}).click();
  pass('unified order vendor and representative details survive reload, and client print preview includes both media sections');
  for(const [path,name] of [['/clients.html','clients'],['/vendors.html?view=reps','vendors']]){
    await page.setViewportSize({width:390,height:844});await page.goto(base+path);await expect(page.locator('#add-record')).toBeEnabled();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Page must fit mobile viewport');
    await page.screenshot({path:'.local-migration/'+name+'-mobile.png',fullPage:true});
    await page.locator('#add-record').click();await expect(page.locator('#record-dialog')).toBeVisible();assert.ok(await page.locator('#record-dialog').evaluate(n=>n.getBoundingClientRect().right<=innerWidth));await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  pass('client/vendor mobile pages and edit dialogs fit a 390px viewport');
}
