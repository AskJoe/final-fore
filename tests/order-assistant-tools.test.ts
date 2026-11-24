import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketMcpServer } from '../lib/order-assistant/tools';
import type { MarketOrderAssistant } from '../lib/order-assistant/service';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
test('MCP rejects scope overrides, pins one market per host conversation, and restricts Apply to the UI',async()=>{
  const bindings=new Map<string,string>();let reads=0,applies=0;
  const fake={runtime:{user:{id:'buyer'}},
    bindChat:async(id:string,session:unknown)=>{
      if(typeof session!=='string')throw new Error('Conversation scope required');
      if(bindings.has(session)&&bindings.get(session)!==id)throw new Error('Start a new chat');
      bindings.set(session,id);
    },read:async(id:string)=>{reads++;return {context:{id},order:{id:'order'}};},
    apply:async()=>{applies++;return {};},
  } as unknown as MarketOrderAssistant;
  const server=createMarketMcpServer(fake),client=new Client({name:'test-host',version:'1.0.0'});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);await client.connect(clientTransport);
  try{
    const tools=(await client.listTools()).tools;
    const read=tools.find(tool=>tool.name==='get_market_context')!;
    assert.equal(read.inputSchema.additionalProperties,false);
    const apply=tools.find(tool=>tool.name==='apply_market_order_changes')!;
    assert.deepEqual(apply._meta?.ui,{visibility:['app']});
    assert.ok(!tools.some(tool=>['saveOrder','finalizeOrder','recordSend'].includes(tool.name)));
    const override=await client.callTool({name:'get_market_context',arguments:{contextId:first,marketId:'other'},_meta:{'openai/session':'chat-one'}});
    assert.equal(override.isError,true);assert.equal(reads,0);
    assert.equal((await client.callTool({name:'get_market_context',arguments:{contextId:first}})).isError,true);
    assert.equal((await client.callTool({name:'get_market_context',arguments:{contextId:first},_meta:{'openai/session':'chat-one'}})).isError,undefined);
    assert.equal((await client.callTool({name:'get_market_context',arguments:{contextId:second},_meta:{'openai/session':'chat-one'}})).isError,true);
    assert.equal((await client.callTool({name:'get_market_context',arguments:{contextId:second},_meta:{'openai/session':'chat-two'}})).isError,undefined);
    const forged=await client.callTool({name:'apply_market_order_changes',arguments:{contextId:first,proposalId:second,hash:'a'.repeat(64),approval:'forged'}});
    assert.equal(forged.isError,true);assert.equal(applies,0);
  }finally{await client.close();await server.close();}
});
