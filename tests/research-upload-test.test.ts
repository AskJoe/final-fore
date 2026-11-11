import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadTestKey} from '../lib/research/upload-test';
import {sourceTemplates} from '../lib/research/templates';
import {groupIncomingFiles} from '../lib/research/inbox-domain';
import type {Recipient} from '../lib/research/types';
import type {ResearchFile} from '../lib/research/uploads';
import type {ResearchManifest} from '../lib/research/requests';
const template=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
const recipient:Recipient={repId:'rep',templateId:template.id,firmId:'firm',firmName:'Firm',name:'Rep',to:'rep@example.test',cc:[]};
test('test upload reuse is bound to exact template, rep and deadline',()=>{
 const k=uploadTestKey(template,recipient,'');assert.equal(k,uploadTestKey(structuredClone(template),{...recipient},''));
 assert.notEqual(k,uploadTestKey({...template,markets:[]},recipient,''));assert.notEqual(k,uploadTestKey(template,{...recipient,repId:'other'},''));assert.notEqual(k,uploadTestKey(template,recipient,'2026-12-01'));
});
test('incoming explicitly includes upload-only previews with a test label, retaining market identity',()=>{
 const manifest={conversationId:'c',templateVersionId:'',templateName:template.name,clientId:'client',campaignKey:'2027',media:template.media,firmName:'Firm',deadline:'',markets:[{marketId:'lincoln',displayName:'Lincoln, NE'}],uploadTestKey:'key'} as ResearchManifest;
 const file={id:'f',conversation_id:'c',market_id:'lincoln',name:'test.txt',size:4,state:'checking',source:'portal',object_key:'secret',sha256:'secret',error:null,created_at:'',updated_at:'',content_type:'text/plain'} as ResearchFile;
 const row={id:'c',mode:'preview',manifest,recipient,files:[file]};assert.deepEqual(groupIncomingFiles([row]),[]);
 const [group]=groupIncomingFiles([row],true);assert.equal(group.marketId,'lincoln');assert.equal(group.files[0].testUpload,true);assert.equal(group.files[0].sender,'Rep · Firm');assert.ok(!('object_key' in group.files[0]));
 assert.deepEqual(groupIncomingFiles([{...row,manifest:{...manifest,uploadTestKey:undefined}}],true),[]);
});
