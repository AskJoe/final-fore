import test from 'node:test';
import assert from 'node:assert/strict';
import {assetVersion,browserCacheable,legacyAsset} from '../lib/legacy-pages';
test('pages request code-only scripts and styles by content version',async()=>{
  const {content}=await legacyAsset('campaign.html');
  assert.ok(content.includes(`src="/campaign.js?v=${await assetVersion('campaign.js')}"`));
  assert.ok(content.includes(`href="/campaign.css?v=${await assetVersion('campaign.css')}"`));
  assert.match(await assetVersion('campaign.js'),/^[a-f0-9]{16}$/);
  assert.notEqual(await assetVersion('campaign.js'),await assetVersion('campaign.css'));
});
test('scripts that embed contact data are never browser-cacheable',async()=>{
  for(const name of ['orders.js','legacy-orders.js','campaign.html','reporting-data.json','favicon.svg'])assert.equal(browserCacheable(name),false,name);
  for(const name of ['campaign.js','campaign.css','app.js','styles.css','reporting.js'])assert.equal(browserCacheable(name),true,name);
  // Their page references keep the original, uncached form.
  const page=(await legacyAsset('legacy-orders.html')).content;
  assert.doesNotMatch(page,/legacy-orders\.js\?v=[a-f0-9]{16}"/);
});
