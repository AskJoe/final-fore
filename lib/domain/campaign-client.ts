import { MARKETS } from './catalogs';
import { check, type Data } from './types';
/** Applies the registered client to a campaign. Shared by the server and the browser calculator. */
export function campaignClient(raw: Data, directory: { clients: Data[] }): Data {
  const id = raw.clientId === 'weed-man' ? 'epic3' : raw.clientId;
  const client = directory.clients.find(c => c.id === id);
  check(client, 'Choose a client from Clients.');
  if(raw.workflow!=='broadcast'||!Array.isArray(raw.markets))return { ...raw, clientId: id, clientName: client.name, brand: client.brand };
  const assigned = new Set(client.marketIds);
  const markets = raw.markets.filter((market: Data)=>assigned.has(market?.marketId));
  const planned = new Set(markets.map((market: Data)=>market.marketId));
  for(const marketId of client.marketIds)if(!planned.has(marketId)){
    markets.push({marketId,region:MARKETS[marketId]?.region??'',start:'',end:'',override:null});
  }
  return { ...raw, clientId:id,clientName:client.name,brand:client.brand,markets };
}
