import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadPagePreviewUrl,uploadLinkPreviewHtml} from '../lib/research/upload-page-preview';
import {renderEmail} from '../lib/research/render';
import {sourceTemplates} from '../lib/research/templates';
import type {Recipient} from '../lib/research/types';
test('staff preview URL encodes only the rep, template and due date',()=>{
  const input={templateId:'tv-multi',repId:'rep & one',deadline:''},url=new URL(uploadPagePreviewUrl(input,'https://app.example.test'));
  assert.equal(url.pathname,'/research-upload/preview');assert.deepEqual(Object.fromEntries(url.searchParams),input);
});
test('preview navigation does not change the original prepared email or its public upload URL',()=>{
  const template=sourceTemplates()[0],recipient:Recipient={templateId:template.id,repId:'rep-one',firmId:'firm',firmName:'Firm',name:'Rep One',to:'rep@example.test',cc:[]};
  const email=renderEmail(template,recipient,{deadline:'2026-12-01'},'https://app.example.test/research-upload/public-token'),before=structuredClone(email);
  const url=uploadPagePreviewUrl({templateId:template.id,repId:recipient.repId,deadline:'2026-12-01'},'https://app.example.test'),html=uploadLinkPreviewHtml(email.html,url);
  assert.match(html,/href="https:\/\/app.example.test\/research-upload\/preview\?/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/&amp;repId=/);
  assert.deepEqual(email,before);assert.match(email.html,/href="https:\/\/app.example.test\/research-upload\/public-token"/);assert.doesNotMatch(email.html,/research-upload\/preview/);
});
