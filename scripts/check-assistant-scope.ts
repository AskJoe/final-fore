import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketMcpServer } from '../lib/order-assistant/tools';
import type { MarketOrderAssistant } from '../lib/order-assistant/service';
import type { OrderSection } from '../lib/order-assistant/types';

export async function checkAssistantScope(assistant: MarketOrderAssistant, contextId: string, section: OrderSection) {
  const server=createMarketMcpServer(assistant);
  const client=new Client({name:'local-browser-test-host',version:'1.0.0'});
  const [host,transport]=InMemoryTransport.createLinkedPair();
  const session={'openai/session':randomUUID()};
  const call=(name:string,params:Record<string,unknown>={})=>
    client.callTool({name,arguments:{contextId,...params},_meta:session});
  try {
    await server.connect(transport);
    await client.connect(host);
    const snapshot=await call('get_market_context');
    assert.ok(!snapshot.isError,JSON.stringify(snapshot.content));
    const data=snapshot.structuredContent as Awaited<ReturnType<MarketOrderAssistant['read']>>;
    assert.equal(data.context.editSection,section);
    assert.deepEqual(data.order.document.lines.map(line=>line.media),['TV','Digital']);
    for (const sheet of ['tv','radio','digital']) {
      const result=await call('search_market_research',{scope:'whole_market',view:{sheet}});
      assert.ok(!result.isError,JSON.stringify(result.content));
      const research=result.structuredContent as Awaited<ReturnType<MarketOrderAssistant['search']>>;
      assert.equal(research.view.sheet,sheet);
      assert.ok(research.rows.every(row=>row.marketId===data.context.marketId));
      if(sheet==='digital')assert.ok(research.rows.length>0);
    }
    const editable=section==='digital'?'digital':'tv';
    const blocked=section==='digital'?'tv':'digital';
    const options={stamp:data.stamp,operationId:randomUUID()};
    const notAllowed=await call('prepare_market_order_changes',
      {...options,changes:{sheet:blocked,add:[],remove:['fixture-'+blocked]}});
    assert.equal(notAllowed.isError,true);
    assert.match(JSON.stringify(notAllowed.content),/can only change/);
    const own=await call('prepare_market_order_changes',
      {...options,changes:{sheet:editable,add:[],remove:['fixture-'+editable]}});
    assert.ok(!own.isError,JSON.stringify(own.content));
    const proposal=(own.structuredContent as {proposal:{section:string;after:{id:string}[]}}).proposal;
    assert.equal(proposal.section,section);
    assert.deepEqual(proposal.after.map(line=>line.id),['fixture-'+blocked]);
  } finally {
    await client.close();
    await server.close();
  }
}
