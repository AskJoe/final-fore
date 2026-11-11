import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTemplates } from '../lib/research/templates';
import { initial } from '../lib/domain/directory';
import { prepareRequest, queuePrepared, parseSendInput, type PreparedPreview, type RequestRepository } from '../lib/research/requests';
import { seal, unseal, hashToken } from '../lib/research/secrets';
import type { TemplateVersion } from '../lib/research/types';

const key=Buffer.alloc(32,8),now=new Date('2026-11-11T12:00:00Z');
const config={origin:'https://research.example.test',replyDomain:'reply.example.test',from:'Sarah <research@example.test>',sarahEmail:'sarah@example.test',secretKey:key};
function version():TemplateVersion {
  const t=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
  return {...t,status:'published',revision:1,version:1,versionId:'version-1',markets:t.markets as {marketId:string;displayName:string}[],defaults:{...t.defaults,radio_trender_books:'Spring 2025–Fall 2026',ranker_books:'Fall 2026',flight_dates:'March–October 2027'}};
}
class Repo implements RequestRepository {
  previews:PreparedPreview[]=[];queued=0;
  async savePreview(p:PreparedPreview){this.previews.push(structuredClone(p));}
  async getPreviews(ids:string[],memberId:string){return this.previews.filter(p=>ids.includes(p.id)&&p.memberId===memberId).map(p=>structuredClone(p));}
  async queueBatch(_memberId:string,_key:string,rows:PreparedPreview[]){this.queued++;return {requestId:'request-1',conversationIds:rows.map(r=>r.id)};}
}
test('prepared preview freezes template markets, email, recipient and portal link together',async()=>{
  const repo=new Repo(),directory=initial(),rep=directory.reps.find(r=>r.name==='Jake Sorensen')!,v=version();
  const p=await prepareRequest({templateId:v.id,repId:rep.id,deadline:'2026-12-01'},v,directory,2,'member-1',repo,config,now);
  assert.deepEqual(p.manifest.markets,[{marketId:'epic3-lincoln',displayName:'Lincoln, NE'}]);
  assert.match(p.email.text,/Lincoln, NE/);assert.ok(p.email.text.includes('/research-upload/'));
  assert.equal(p.email.missing.length,0);assert.notEqual(p.externalReplyHash,p.staffReplyHash);
  assert.equal(repo.previews.length,1);v.markets[0].displayName='Changed';assert.equal(repo.previews[0].manifest.markets[0].displayName,'Lincoln, NE');
  const secrets=unseal<{portalToken:string;externalToken:string;staffToken:string}>(p.secrets,config.secretKey);
  assert.equal(hashToken(secrets.portalToken),p.portalHash);assert.equal(hashToken(secrets.staffToken),p.staffReplyHash);
  assert.ok(!p.email.text.includes(secrets.staffToken));
});
test('send uses owned, unexpired, exactly reviewed previews and rejects request market overrides',async()=>{
  const repo=new Repo(),d=initial(),rep=d.reps.find(r=>r.name==='Jake Sorensen')!;
  const p=await prepareRequest({templateId:version().id,repId:rep.id,deadline:'2026-12-01'},version(),d,2,'member-1',repo,config,now);
  const raw={idempotencyKey:'12345678-1234-4234-8234-123456789012',previews:[{previewId:p.id,renderHash:p.email.renderHash}]};
  assert.throws(()=>parseSendInput({...raw,markets:['wrong']}),/template|Unknown/);
  await assert.rejects(queuePrepared(raw,'other-member',repo,false,now),/sending.*disabled/i);
  await assert.rejects(queuePrepared(raw,'other-member',repo,true,now),/preview/i);
  await assert.rejects(queuePrepared({...raw,previews:[{previewId:p.id,renderHash:'changed'}]},'member-1',repo,true,now),/preview|changed/i);
  await assert.rejects(queuePrepared(raw,'member-1',repo,true,new Date('2026-11-13')),/expired/i);
  const result=await queuePrepared(raw,'member-1',repo,true,now);assert.deepEqual(result.conversationIds,[p.id]);assert.equal(repo.queued,1);
});
test('routing secrets reject tampering and never decode with a different key',()=>{
  const boxed=seal({staffToken:'private'},key);
  assert.deepEqual(unseal(boxed,key),{staffToken:'private'});
  assert.throws(()=>unseal(boxed,Buffer.alloc(32,9)));
  assert.throws(()=>unseal(boxed.slice(0,-5)+'xxxxx',key));
});
