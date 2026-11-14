import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRelay, buildRelayPayload, type ReceivedMessage, type RelayContext } from '../lib/research/relay';
const context:RelayContext={conversationId:'conv-1',sarahEmail:'sarah@example.test',from:'Sarah <research@example.test>',replyDomain:'reply.example.test',externalToken:'a'.repeat(64),staffToken:'b'.repeat(64),recipient:{to:'rep@example.test',cc:['assistant@example.test']},lastVendorMessageId:'<vendor-previous@example.test>',lastGmailMessageId:'<gmail-previous@example.test>'};
const incoming:ReceivedMessage={id:'inbound-1',messageId:'<rep-message@example.test>',from:'John <rep@example.test>',to:[`reply-${context.externalToken}@${context.replyDomain}`],cc:[],subject:'Re: Research',text:'Here is the research.',html:'<p>Here is the research.</p>',headers:{},authentication:{dkim:'pass'},attachments:[]};
test('rep reply is captured and forwarded only to Sarah with a private staff Reply-To',()=>{
  assert.equal(decideRelay(incoming,'external',context).action,'to-sarah');
  const p=buildRelayPayload(incoming,'to-sarah',context);
  assert.deepEqual(p.to,['sarah@example.test']);assert.deepEqual(p.cc,[]);
  assert.equal(p.replyTo,`staff-${context.staffToken}@${context.replyDomain}`);
  assert.equal(p.headers?.['In-Reply-To'],context.lastGmailMessageId);
  assert.match(p.from,/via Final Fore/);assert.ok(!p.from.includes('<rep@example.test>'));
});
test('Sarah Gmail reply needs exact sender and provider authentication; forged headers do not authorize it',()=>{
  const m={...incoming,from:'Sarah <sarah@example.test>',to:[`staff-${context.staffToken}@${context.replyDomain}`],headers:{'Authentication-Results':'dkim=pass'}};
  assert.equal(decideRelay(m,'staff',context).action,'to-vendor');
  assert.equal(decideRelay({...m,authentication:null},'staff',context).action,'held');
  assert.equal(decideRelay({...m,from:'other@example.test'},'staff',context).action,'held');
  assert.equal(decideRelay({...m,cc:['surprise@example.test']},'staff',context).action,'held');
});
test('relayed staff reply preserves content and attachments but removes staff tokens from quoted text and HTML',()=>{
  const m={...incoming,from:'sarah@example.test',text:`My answer.\nOn Monday reply to staff-${context.staffToken}@${context.replyDomain}`,html:`<p>My answer.</p><script>alert(1)</script><img src="https://tracker.example/pixel"><a href="mailto:staff-${context.staffToken}@${context.replyDomain}">Reply</a>`,attachments:[{filename:'rates.pdf',content:'cGRm'}]};
  const p=buildRelayPayload(m,'to-vendor',context);
  assert.deepEqual(p.to,['rep@example.test']);assert.deepEqual(p.cc,['assistant@example.test']);
  assert.ok(p.text.includes('My answer.'));assert.ok(!p.text.includes(context.staffToken));assert.ok(!p.html?.includes(context.staffToken));
  assert.doesNotMatch(p.html??'',/<script|tracker\.example/);assert.deepEqual(p.attachments,m.attachments);
  assert.equal(p.headers?.['In-Reply-To'],context.lastVendorMessageId);
});
test('automated replies are recorded without creating mail loops',()=>{
  assert.equal(decideRelay({...incoming,headers:{'Auto-Submitted':'auto-replied'}},'external',context).action,'no-relay');
  assert.equal(decideRelay({...incoming,headers:{'X-Final-Fore-Relay':'conv-1'}},'external',context).action,'no-relay');
});
