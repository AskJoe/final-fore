import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalToken,verifyApproval } from '../lib/order-assistant/approval';
import { chatgptLaunchUrl } from '../lib/order-assistant/launch';
import { validateMcpClaims } from '../lib/order-assistant/auth';

test('MCP requires the exact trusted issuer, audience, OAuth client and live verified subject',()=>{
  const expected={issuer:'https://auth.example/auth/v1',audience:'https://app.example/mcp',clientId:'approved',userId:'buyer'};
  const claims={iss:expected.issuer,aud:[expected.audience,'authenticated'],client_id:'approved',sub:'buyer',exp:2000,role:'authenticated'};
  assert.doesNotThrow(()=>validateMcpClaims(claims,expected,1000));
  for(const raw of [{...claims,iss:'https://other.example'},{...claims,aud:'authenticated'},
    {...claims,client_id:'other'},{...claims,client_id:undefined},{...claims,sub:'other'},
    {...claims,exp:999},{...claims,role:'service_role'}])assert.throws(()=>validateMcpClaims(raw,expected,1000));
});

test('approval is hidden UI data bound to user, market context, exact proposal and expiry',()=>{
  const token=approvalToken('test-secret','buyer','denver-context','proposal-hash',1_800_000_000_000);
  assert.doesNotThrow(()=>verifyApproval(token,'test-secret','buyer','denver-context','proposal-hash',1_800_000_000_000));
  for(const [user,context,hash] of [['other','denver-context','proposal-hash'],['buyer','austin-context','proposal-hash'],
    ['buyer','denver-context','changed-hash']])assert.throws(()=>verifyApproval(token,'test-secret',user,context,hash,1_800_000_000_000));
  assert.throws(()=>verifyApproval(token,'test-secret','buyer','denver-context','proposal-hash',1_800_002_000_000));
});

test('launch uses the registered plugin entrypoint and carries only a nonauthorizing context reference',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const url=new URL(chatgptLaunchUrl('verified-plugin-id',id));
  assert.equal(url.origin,'https://chatgpt.com');
  assert.equal(url.pathname,'/plugins/verified-plugin-id/app/open_market_order');
  assert.equal(url.searchParams.get('path'),'/market-order?context='+id);
  assert.equal([...url.searchParams].length,1);
  assert.throws(()=>chatgptLaunchUrl(undefined,id));
  assert.throws(()=>chatgptLaunchUrl('../another',id));
});
