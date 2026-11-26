import assert from 'node:assert/strict';
import { expect, type BrowserContext, type Page, type Request, type Route } from '@playwright/test';
import { browserOrders } from '../tests/mock-unified-orders';
import type { OrderSection } from '../lib/order-assistant/types';

export async function checkCampaign(page: Page, context: BrowserContext, base: string, legacyCampaignId: string,
  pass: (label: string) => void, checkAssistant: (contextId:string, section:OrderSection) => Promise<void>) {
  const { clientId, year, marketId, campaignId, orderId, orderNumber } = browserOrders;
  const plan = '/campaign.html?workflow=broadcast&id=' + campaignId;
  const oldPlan = '/campaign.html?workflow=digital&id=' + legacyCampaignId;
  const scope = { clientId, year: String(year), campaignId };
  const oldScope = new URLSearchParams({ ...scope, campaignId: legacyCampaignId, workflow: 'digital' });
  const archivedOrder = '/orders.html?' + new URLSearchParams({ campaign: legacyCampaignId, market: marketId });
  const registry=await context.request.get(base+'/api/campaigns');
  assert.equal(registry.status(),200);
  const {campaigns}=await registry.json();
  const legacyIds=new Set<string>([legacyCampaignId,...campaigns.filter((record:{workflow:string})=>record.workflow!=='broadcast')
    .map((record:{id:string})=>record.id)]);
  const isSavedPaper = (url: URL) => url.pathname + url.search === archivedOrder;
  function pointsToRetiredPlanner(url: URL) {
    if (url.origin !== base) return false;
    if (url.pathname === '/orders.html') return true;
    if (!['/campaign.html', '/campaign/calendar', '/campaign/orders', '/orders'].includes(url.pathname)) return false;
    const idKey = url.pathname === '/campaign.html' ? 'id' : 'campaignId';
    return url.searchParams.getAll('workflow').includes('digital') || url.searchParams.getAll(idKey).some(id=>legacyIds.has(id));
  }
  async function checkLinks({ history = false } = {}) {
    const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
    const retired = links.filter(href => {
      const url = new URL(href);
      return pointsToRetiredPlanner(url) && !(history && isSavedPaper(url));
    });
    assert.deepEqual(retired, [], 'Links to retired campaign routes on ' + page.url());
  }
  async function checkPlan() {
    await expect(page).toHaveURL(base + plan);
    await expect(page.getByRole('link', { name: 'Austin Digital order', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /legacy digital campaigns/i })).toHaveCount(0);
    await expect(page.locator('#campaign-picker')).toHaveValue(campaignId);
    await expect(page.getByRole('columnheader', { name: 'Actual', exact: true }).last()).toBeVisible();
    await checkLinks();
  }
  async function checkRedirect(from: string, to: string, params: Record<string, string>) {
    const response = await context.request.get(base + from, { maxRedirects: 0 });
    assert.equal(response.status(), 307, from);
    const location = new URL(response.headers().location, base);
    assert.equal(location.pathname, to, from);
    assert.deepEqual(Object.fromEntries(location.searchParams), params, from);
  }
  const canonicalPlan = { workflow: 'broadcast', id: campaignId };
  await checkRedirect(oldPlan, '/campaign.html', canonicalPlan);
  await checkRedirect('/campaign.html?id=' + legacyCampaignId, '/campaign.html', canonicalPlan);
  await checkRedirect('/campaign.html?workflow=digital', '/campaign.html', { workflow: 'broadcast' });
  await checkRedirect('/campaign/calendar?' + oldScope, '/campaign/calendar', { ...scope, workflow: 'broadcast' });
  await checkRedirect('/campaign/orders?' + oldScope + '&marketId=' + marketId, '/campaign/orders',
    { ...scope, workflow: 'broadcast', marketId, section: 'digital' });
  await checkRedirect('/orders.html', '/campaign/orders', {});
  await checkRedirect('/orders.html?campaign=' + legacyCampaignId + '&market=epic3-arkansas-nwa', '/campaign/orders',
    { ...scope, workflow: 'broadcast', marketId: 'epic3-arkansas-nwa', section: 'digital' });
  await page.goto(base + oldPlan);
  await checkPlan();
  pass('legacy planner, calendar and order bookmarks redirect to the unified campaign');

  const badNavigations: string[] = [];
  const traceNavigation = (request: Request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    const url = new URL(request.url());
    if (pointsToRetiredPlanner(url) && !isSavedPaper(url)) badNavigations.push(url.href);
  };
  page.on('request', traceNavigation);
  const launchDestination='https://chatgpt.com/plugins/local-browser-fixture/app/open_market_order?*';
  const blockExternalLaunch=(route:Route)=>route.abort();
  await context.route(launchDestination,blockExternalLaunch);
  try {
    const austin = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Austin Digital order', exact: true }) });
    for (const [column, amount] of [['Broadcast', '$1,000.00'], ['Weather reserve', '$200.00'],
      ['Digital', '$2,300.00'], ['Actual', '$3,300.00']]) {
      await expect(austin.locator('td[data-label="' + column + '"]')).toHaveText(amount);
    }
    await expect(austin.getByLabel('Austin proposed budget')).toHaveValue('$4,000.00');

    const editor = page.getByRole('region', { name: 'Order editor' });
    async function openOrder(control: ReturnType<Page['getByRole']>, section: 'Broadcast' | 'Digital') {
      const seeded = page.waitForResponse(response =>
        new URL(response.url()).searchParams.get('view') === 'seed' && new URL(response.url()).pathname === '/api/orders');
      await control.click();
      const response = await seeded;
      assert.equal(response.status(), 200, await response.text());
      assert.equal((await response.json()).order.id, orderId);
      await expect(editor.getByRole('heading', { name: orderNumber, exact: true })).toBeVisible();
      await expect(editor.getByRole('group', { name: 'Placement section' }).getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-pressed', 'true');
      const placements = (name: string) => editor.getByRole('region', { name: name + ' placements', exact: true });
      await expect(placements(section).getByText('Editing', { exact: true })).toBeVisible();
      await expect(placements(section === 'Digital' ? 'Broadcast' : 'Digital').getByText('View only', { exact: true })).toBeVisible();
      await expect(editor.getByText('Total due $3,300.00', { exact: true })).toBeVisible();
      await checkLinks();
    }

    for (const section of ['Broadcast', 'Digital'] as const) {
      await openOrder(page.getByRole('link', { name: 'Austin ' + section + ' order', exact: true }), section);
      const launchResponse=page.waitForResponse(response=>response.url()===base+'/api/order-assistant'&&
        response.request().postDataJSON()?.action==='launch');
      const popup=page.waitForEvent('popup');
      await editor.getByRole('button',{name:/Ask ChatGPT/}).click();
      const launch=await launchResponse;
      assert.equal(launch.status(),200,await launch.text());
      const {contextId,editSection,url}=await launch.json();
      assert.equal(editSection,section.toLowerCase());
      assert.equal(new URL(url).searchParams.get('path'),'/market-order?context='+contextId);
      await (await popup).close();
      const read=await context.request.post(base+'/api/order-assistant',{
        headers:{origin:base},data:{action:'read',contextId},
      });
      assert.equal(read.status(),200,await read.text());
      const assistant=await read.json();
      assert.equal(assistant.context.editSection,editSection);
      assert.equal(assistant.order.id,orderId);
      assert.deepEqual(assistant.order.document.lines.map((line:{media:string})=>line.media),['TV','Digital']);
      await checkAssistant(contextId,section==='Digital'?'digital':'broadcast');
      const back = editor.getByRole('link', { name: /Back to campaign plan/ });
      await expect(back).toHaveAttribute('href', plan);
      await expect(editor.getByText('Draft saved', { exact: true })).toBeVisible();
      await back.click();
      await checkPlan();
    }
    pass('Broadcast and Digital use the same saved order, preserve edit boundaries and show fees in Actual');
    pass('Ask ChatGPT reads both sides and their research from either launch, and rejects proposals for the other side');

    await page.getByRole('link', { name: 'Calendar', exact: true }).click();
    for (const step of ['TV', 'Radio', 'Digital']) {
      await openOrder(page.getByRole('button', { name: step, exact: true }), step === 'Digital' ? 'Digital' : 'Broadcast');
      await expect(editor.getByText('Draft saved', { exact: true })).toBeVisible();
      await editor.getByRole('button', { name: /Back to calendar/ }).click();
      await expect(editor).toBeHidden();
      await checkLinks();
    }
    await page.getByRole('link', { name: 'Campaign plan', exact: true }).click();
    await checkPlan();
    pass('TV, Radio and Digital calendar entries open the shared order and return to the unified campaign');

    await page.getByText('Orders', { exact: true }).click();
    await checkLinks();
    await page.getByRole('link', { name: 'Order list', exact: true }).click();
    await expect(page.getByRole('button', { name: orderNumber, exact: true })).toBeVisible();
    await checkLinks();
    await page.getByRole('link', { name: 'Campaign plan', exact: true }).click();
    await checkPlan();
    await page.getByText('Orders', { exact: true }).click();
    await page.getByRole('link', { name: 'Historical orders', exact: true }).click();
    const oldPaperLink = page.locator('a[href="' + archivedOrder + '"]');
    await expect(oldPaperLink).toBeVisible();
    await checkLinks({ history: true });
    await oldPaperLink.click();
    const paper = page.getByRole('article', { name: 'Saved order', exact: true });
    await expect(paper).toContainText('Austin');
    await expect(page.getByRole('status')).toHaveText('View only');
    await expect(page.getByRole('button', { name: 'Print / Save PDF', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save draft|Create \/ open order|Refresh from campaign/ })).toHaveCount(0);
    await checkLinks();
    await page.pdf({ path: '.local-migration/campaign-order-preview.pdf', format: 'Letter' });
    assert.deepEqual(badNavigations, [], 'Normal navigation requested a retired campaign route');
    pass('Orders navigation has no retired planner links and saved historical paperwork stays printable and read-only');
  } finally {
    page.off('request', traceNavigation);
    await context.unroute(launchDestination,blockExternalLaunch);
  }

  await page.goto(base + plan);
  await checkPlan();
  const previews: string[] = [];
  const tracePreview = (request: Request) => { if (request.url().endsWith('/api/campaign/preview')) previews.push(request.url()); };
  page.on('request', tracePreview);
  try {
    await page.waitForLoadState('networkidle');
    const update = page.waitForResponse(response =>
      response.url() === base + '/api/campaign' && response.request().method() === 'POST');
    const proposed = page.getByLabel('Austin proposed budget', { exact: true });
    await proposed.fill('3500');
    await proposed.blur();
    await expect(page.locator('#remaining')).toHaveText('$500.00');
    const response = await update;
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual(previews, []);
    await page.reload();
    await expect(proposed).toHaveValue('$3,500.00');
    pass('unified budget edits recalculate locally, save and survive reload');

    await page.waitForLoadState('networkidle');
    const failApi = '**/api/**';
    await page.route(failApi, route => route.abort());
    try {
      await page.reload();
      await expect(page.locator('#save-status')).toHaveText('Offline copy');
      await expect(proposed).toHaveValue('$3,500.00');
      await checkPlan();
    } finally {
      await page.unroute(failApi);
    }
    pass('unified campaign opens from its saved copy when its APIs are unavailable');
  } finally {
    page.off('request', tracePreview);
  }
}
