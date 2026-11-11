import test from 'node:test';
import assert from 'node:assert/strict';
import { groupIncomingFiles, parseReply, validateFileAssignment } from '../lib/research/inbox-domain';

test('incoming files group by client, campaign, channel and market; preview files stay out',()=>{
  const base={id:'one',mode:'live',manifest:{clientId:'a',campaignKey:'2027',media:'broadcast-tv',markets:[{marketId:'austin',displayName:'Austin, TX'}]},recipient:{name:'John',firmName:'Katz'}};
  const groups=groupIncomingFiles([{...base,files:[{id:'f1',market_id:'austin',name:'rates.pdf'}]},{...base,id:'two',manifest:{...base.manifest,clientId:'b'},files:[{id:'f2',market_id:'austin',name:'rates.pdf'}]},{...base,id:'preview',mode:'preview',files:[{id:'sample',market_id:'austin',name:'sample.pdf'}]}] as any);
  assert.equal(groups.length,2);assert.deepEqual(groups.flatMap(g=>g.files.map(f=>f.id)),['f1','f2']);
  assert.equal(groups[0].files[0].sender,'John · Katz');
});
test('email attachment assignment must be inside its conversation template',()=>{
  const file={source:'email',market_id:null};const markets=[{marketId:'austin',displayName:'Austin, TX'}];
  assert.equal(validateFileAssignment(file as any,'austin',markets),'austin');
  assert.throws(()=>validateFileAssignment(file as any,'wrong-client',markets),/template/);
  assert.throws(()=>validateFileAssignment({...file,source:'portal'} as any,'austin',markets),/already/);
});
test('in-app reply permits only content and a stable operation key',()=>{
  const valid={conversationId:'12345678-1234-1234-1234-123456789012',idempotencyKey:'22345678-1234-1234-1234-123456789012',text:'Thanks, please send the rate card.'};
  assert.equal(parseReply(valid).text,valid.text);
  assert.throws(()=>parseReply({...valid,to:'another@example.com'}),/Unknown/);
  assert.throws(()=>parseReply({...valid,text:'  '}),/reply/);
  assert.throws(()=>parseReply({...valid,marketIds:['wrong']}),/Unknown/);
});
