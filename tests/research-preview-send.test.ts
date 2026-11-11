import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewCopy } from '../lib/research/preview-send';
import { seal, unseal, hashToken } from '../lib/research/secrets';

test('preview email gets a separate temporary portal and internal-only recipient',()=>{
  const key=Buffer.alloc(32,1),portalToken='a'.repeat(64),config={origin:'https://app.example.com',replyDomain:'reply.example.com',from:'Sarah <research@example.com>',sarahEmail:'sarah@example.com',secretKey:key};
  const original={id:'original',memberId:'member',versionId:'version',manifest:{conversationId:'original',markets:[{marketId:'austin',displayName:'Austin, TX'}]},recipient:{to:'rep@example.com',cc:['other@example.com']},email:{subject:'Research',text:'Upload: https://app.example.com/research-upload/'+portalToken,html:'<a href="https://app.example.com/research-upload/'+portalToken+'">Upload</a>',missing:[]},secrets:seal({portalToken},key)};
  const copy=buildPreviewCopy(original as any,'sarah@example.com','member@example.com',config);
  const payload=unseal<any>(copy.dispatch,key);
  assert.deepEqual(payload.to,['sarah@example.com']);assert.deepEqual(payload.cc,[]);
  assert.ok(!payload.text.includes(portalToken));assert.ok(!payload.html.includes(portalToken));
  assert.ok(payload.subject.startsWith('[PREVIEW]'));
  assert.equal(copy.manifest.markets[0].marketId,'austin');
  assert.notEqual(copy.id,'original');assert.notEqual(copy.portalHash,hashToken(portalToken));
  assert.equal(new Date(copy.expiresAt).getTime()-new Date(copy.createdAt).getTime(),86400000);
  assert.throws(()=>buildPreviewCopy(original as any,'rep@example.com','member@example.com',config),/internal/);
});
