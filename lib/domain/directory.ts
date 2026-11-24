import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHANNELS, CATALOG, MARKETS } from './catalogs';
import { check, object, type Data } from './types';

export const DIRECTORY_KEY = 'directory';
export const MEDIA_TYPES = [
  { id: 'broadcast-tv', name: 'Broadcast TV' },
  { id: 'broadcast-radio', name: 'Broadcast Radio' },
  { id: 'digital', name: 'Digital' },
];
export const COLLECTIONS = ['clients', 'firms', 'reps', 'stations'] as const;
export type Collection = typeof COLLECTIONS[number];
export type Directory = Record<Collection, Data[]>;
const seed = JSON.parse(readFileSync(path.join(process.cwd(), 'data/vendor-reference.json'), 'utf8')) as Directory;
export function initial(): Directory { return structuredClone(seed); }
export function channelMedia(id: string): string | undefined {
  return id === 'r4' ? 'broadcast-tv' : id === 'r5' ? 'broadcast-radio' : CHANNELS[id]?.kind === 'digital' ? 'digital' : undefined;
}
export function catalog() {
  return { mediaTypes: MEDIA_TYPES, channels: Object.values(CHANNELS).filter(c => channelMedia(c.id)), markets: CATALOG.markets.map((m: Data) => ({ id: m.id, name: m.name, current: m.current, buyingGroup: m.buyingGroup })) };
}
function text(value: unknown, label: string, max = 200, required = false): string {
  check(typeof value === 'string' && value.length <= max && (!required || !!value.trim()), `${label}: ${required ? 'enter' : 'use'} ${required ? '1–' : 'at most '}${max} characters.`);
  return value.trim();
}
function ids(value: unknown, label: string, max: number): string[] {
  check(Array.isArray(value) && value.length <= max && value.every(v => typeof v === 'string') && new Set(value).size === value.length, `Invalid ${label}.`);
  return value;
}
function reference(records: Data[], id: string, label: string, optional = false) {
  check(optional && !id || records.some(r => r.id === id), `Choose a valid ${label}.`);
}
function mediaType(value: unknown) {
  check(MEDIA_TYPES.some(m => m.id === value), 'Choose Broadcast TV, Broadcast Radio, or Digital.');
  return value as string;
}
export function cleanEntity(kind: Collection, raw: unknown, directory: Directory): Data {
  check(object(raw), 'Enter valid directory details.');
  const extra: Record<Collection, string[]> = { clients: ['brand', 'marketIds'], firms: ['roles'], reps: ['firmId', 'email', 'phone', 'coverage'], stations: ['mediaType', 'market', 'network', 'ownerFirmId', 'repFirmId'] };
  check(Object.keys(raw).every(k => ['id', 'name', 'active', 'notes', 'source', ...extra[kind]].includes(k)), 'Unknown directory field.');
  const result: Data = { id: text(raw.id, 'ID', 80, true), name: text(raw.name, 'Name', 200, true), active: raw.active ?? true, notes: text(raw.notes ?? '', 'Notes', 12000), source: text(raw.source ?? '', 'Source', 3000) };
  check(/^[a-zA-Z0-9-]+$/.test(result.id), 'Invalid directory ID.');
  check(typeof result.active === 'boolean', 'Invalid active status.');
  if (kind === 'clients') {
    result.brand = text(raw.brand ?? '', 'Brand');
    result.marketIds = ids(raw.marketIds ?? [], 'franchise markets', 200);
    for (const id of result.marketIds) {
      check(Object.hasOwn(MARKETS, id), 'Choose a franchise market from the catalog.');
      check(!directory.clients.some(c => c.id !== result.id && c.marketIds.includes(id)), 'This franchise market already belongs to another client.');
    }
  }
  if (kind === 'firms') {
    result.roles = ids(raw.roles ?? [], 'firm roles', 3);
    check(result.roles.length > 0 && result.roles.every((r: string) => ['rep-firm', 'station-owner', 'direct-vendor'].includes(r)), 'Choose at least one firm role.');
  }
  if (kind === 'stations') {
    result.mediaType = mediaType(raw.mediaType);
    result.market = text(raw.market ?? '', 'Market'); result.network = text(raw.network ?? '', 'Network');
    for (const key of ['ownerFirmId', 'repFirmId']) {
      result[key] = text(raw[key] ?? '', key, 80); reference(directory.firms, result[key], 'firm', true);
    }
  }
  if (kind === 'reps') {
    result.firmId = text(raw.firmId, 'Firm', 80, true); reference(directory.firms, result.firmId, 'firm');
    result.email = text(raw.email ?? '', 'Email', 254); result.phone = text(raw.phone ?? '', 'Phone', 100);
    check(!result.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email), 'Enter a valid email address.');
    check(Array.isArray(raw.coverage) && raw.coverage.length <= 200, 'Use up to 200 coverage assignments.');
    result.coverage = raw.coverage.map((c: unknown) => {
      check(object(c) && Object.keys(c).every(k => ['mediaType', 'channelId', 'stationId', 'market', 'notes'].includes(k)), 'Invalid coverage assignment.');
      const item = { mediaType: mediaType(c.mediaType), channelId: text(c.channelId ?? '', 'Channel', 80), stationId: text(c.stationId ?? '', 'Station', 80), market: text(c.market ?? '', 'Coverage market'), notes: text(c.notes ?? '', 'Coverage notes', 2000) };
      check(!item.channelId || channelMedia(item.channelId) === item.mediaType, 'The channel must match the coverage media type.');
      reference(directory.stations, item.stationId, 'station', true);
      const station = directory.stations.find(s => s.id === item.stationId);
      check(!station || station.mediaType === item.mediaType, 'The station must match the coverage media type.');
      check(!station || !item.market || station.market === item.market, 'Use the station’s market for this coverage assignment.');
      return item;
    });
  }
  return result;
}
export function update(directory: Directory, collection: unknown, raw: unknown) {
  check(COLLECTIONS.includes(collection as Collection), 'Choose a directory record type.');
  check(object(raw), 'Enter directory details.');
  const kind = collection as Collection, id = raw.id || randomUUID();
  check(!raw.id || directory[kind].some(r => r.id === id), 'This record no longer exists. Reload the directory.');
  const result = structuredClone(directory), entity = cleanEntity(kind, { ...raw, id }, directory);
  const index = result[kind].findIndex(r => r.id === id);
  if (index < 0) { check(result[kind].length < 5000, 'The directory limit is 5,000 records per type.'); result[kind].push(entity); }
  else result[kind][index] = entity;
  // Validate relationships after edits too (e.g. changing a station's media type).
  for (const key of COLLECTIONS) for (const row of result[key]) cleanEntity(key, row, result);
  return { directory: result, entity };
}

// Legacy records are interpreted at the service boundary; stored rows are not rewritten on read.
export function campaignClient(raw: Data, directory: Directory): Data {
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

export function vendorSnapshot(raw: Data | undefined, directory: Directory, media: string, previous?: Data): Data | undefined {
  if (!raw) return undefined;
  // Unchanged saved selections keep their original names and contact details.
  if (previous && raw.firmId === previous.firmId && (raw.repId ?? '') === (previous.repId ?? '')) return structuredClone(previous);
  const firm = directory.firms.find(f => f.id === raw.firmId && f.active);
  check(firm, 'Choose an active vendor firm.');
  const rep = raw.repId ? directory.reps.find(r => r.id === raw.repId && r.active) : undefined;
  check(!raw.repId || rep && rep.firmId === firm.id, 'The rep must belong to the selected vendor firm.');
  check(!rep || rep.coverage.some((c: Data) => c.mediaType === media), 'The rep does not have coverage for this media type.');
  return { firmId: firm.id, firmName: firm.name, repId: rep?.id ?? '', repName: rep?.name ?? '', email: rep?.email ?? '' };
}
