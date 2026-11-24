import { loadWorkbookPage } from '../broadcast/store';
import { check } from '../domain/types';
import type { Directory } from '../domain/directory';
import { attestLine } from './provenance';
import { broadcastOrderResearch,loadOrderArchive,orderResearch,type ResearchQuery } from './sources';
import { ordersSecret,type OrderRuntime } from './runtime';

/** Shared by the native research pane and MCP; the caller supplies a verified member client. */
export async function loadOrderResearch(directory:Directory,params:URLSearchParams,memberClient:OrderRuntime['supabase'],
  scope:{clientId:string;marketId:string;year:number},filters:Pick<ResearchQuery,'selection'|'shortlist'|'includeMarketCoverage'>={},researchApiKey?:string) {
  check(directory.clients.some(client=>client.id===scope.clientId && client.marketIds.includes(scope.marketId)),
    'Choose a market assigned to this client.');
  const get=(key:string)=>params.get(key)??'';
  const workflow=get('workflow');
  check(workflow==='broadcast'||workflow==='digital','Choose an order workflow.');
  const sheet=get('sheet')||(workflow==='digital'?'digital':'tv');
  const cpm=(key:string)=>{const value=get(key);return /^\d{1,11}$/.test(value)?Number(value):undefined;};
  const query:ResearchQuery={...scope,workflow,sheet,page:Number(get('page')||1),q:get('q').slice(0,200),
    rep:get('rep'),firm:get('firm'),primary:get('primary'),secondary:get('secondary'),sort:get('sort'),...filters,
    quoteFilters:get('quoteFilters')==='1'&&(sheet==='tv'||sheet==='radio')?
      {station:get('station').slice(0,120),exact:cpm('exactCpm'),low:cpm('lowCpm'),high:cpm('highCpm')}:undefined,
    quotesOnly:(sheet==='radio'||sheet==='tv')&&get('avails')==='1'};
  const research=workflow==='broadcast'&&!['station-history','digital-history','digital'].includes(sheet)?
    await broadcastOrderResearch(directory,query,(name,input)=>loadWorkbookPage(name,input,memberClient,researchApiKey),
      sheet==='radio'?(await loadOrderArchive())?.radioQuoteDetails:undefined):
    orderResearch(await loadOrderArchive(),directory,query);
  return {...research,rows:research.rows.map(row=>({...row,line:row.line&&attestLine(row.line,query,ordersSecret()),
    periods:row.periods?.map(period=>({...period,line:attestLine(period.line,query,ordersSecret())}))}))};
}
