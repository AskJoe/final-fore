import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePortal, validateUpload, verifyUploadedFile, type PortalRecord } from '../lib/research/portals';
import { hashToken } from '../lib/research/secrets';
import { createHash } from 'node:crypto';
const token='a'.repeat(64),bytes=Buffer.from('%PDF-1.4\nA small research file\n%%EOF');
const record:PortalRecord={id:'conversation-1',portalState:'open',mode:'live',manifest:{conversationId:'conversation-1',templateVersionId:'v1',templateName:'Radio Lincoln',clientId:'epic3',campaignKey:'2027',media:'broadcast-radio',firmName:'BDP',deadline:'2026-12-01',markets:[{marketId:'epic3-lincoln',displayName:'Lincoln, NE'}]},recipient:{repId:'rep-1',firmId:'firm-1',templateId:'radio-single-lincoln',name:'Jake',firmName:'BDP',to:'jake@example.test',cc:[]}};
test('portal tokens expose only their own fixed manifest and reject closed/revoked writes',async()=>{
  const repo={find:async(hash:string)=>hash===hashToken(token)?structuredClone(record):null};
  assert.equal((await authorizePortal(token,repo,true)).id,'conversation-1');
  await assert.rejects(authorizePortal('b'.repeat(64),repo,true),/not available/i);
  await assert.rejects(authorizePortal(token,{find:async()=>({...record,portalState:'closed'})},true),/closed/i);
  assert.equal((await authorizePortal(token,{find:async()=>({...record,portalState:'closed'})},false)).portalState,'closed');
  await assert.rejects(authorizePortal(token,{find:async()=>({...record,portalState:'revoked'})},false),/not available/i);
});
test('upload input cannot substitute a market, client, storage path, or unsupported file',()=>{
  const input={marketId:'epic3-lincoln',name:'Research.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.equal(validateUpload(input,record).contentType,'application/pdf');
  for(const bad of [{...input,marketId:'epic3-austin'},{...input,path:'another-client/file'},{...input,clientId:'other'},{...input,name:'rates.xlsm'},{...input,name:'report.html'},{...input,size:101*1024*1024},{...input,size:0}])assert.throws(()=>validateUpload(bad,record));
});
test('final file verification checks bytes, hash, real type and scanner before Ready',async()=>{
  const metadata={name:'Research.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'application/pdf'};
  assert.equal(await verifyUploadedFile(bytes,metadata,async()=>true),'ready');
  assert.equal(await verifyUploadedFile(bytes,metadata,async()=>false),'held');
  await assert.rejects(verifyUploadedFile(bytes,{...metadata,sha256:'0'.repeat(64)},async()=>true),/hash/i);
  await assert.rejects(verifyUploadedFile(Buffer.alloc(bytes.length,0),metadata,async()=>true),/hash|format/i);
  await assert.rejects(verifyUploadedFile(bytes,{...metadata,size:bytes.length+1},async()=>true),/size/i);
});
