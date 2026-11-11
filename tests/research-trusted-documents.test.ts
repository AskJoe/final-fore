import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateUploadedDocument} from '../lib/research/portals';
function metadata(bytes:Buffer){return {name:'rates.txt',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'text/plain'};}
test('trusted documents complete with byte integrity checks and no scanner dependency',async()=>{
 const bytes=Buffer.from('Market rates, verified complete.');await validateUploadedDocument(bytes,metadata(bytes));
 await assert.rejects(validateUploadedDocument(bytes,{...metadata(bytes),size:bytes.length+1}),/size/);
 await assert.rejects(validateUploadedDocument(bytes,{...metadata(bytes),sha256:'a'.repeat(64)}),/hash/);
 await assert.rejects(validateUploadedDocument(bytes,{...metadata(bytes),name:'rates.pdf',contentType:'application/pdf'}),/extension/);
});
