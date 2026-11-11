import { randomUUID } from 'node:crypto';
import { check, Conflict, type Data, type Workbook } from './domain/types';
import * as workbook from './domain/workbook';
import * as campaigns from './domain/campaigns';
import * as orders from './domain/orders';
import * as campaignOrders from './domain/campaign-orders';
import { OPTIONS } from './domain/catalogs';
import { StorageError, type Store } from './store';
import * as directory from './domain/directory';
import * as planning from './domain/planning';
export const campaignKey = (id: string) => 'campaign:' + id;
export const orderKey = (id: string, market: string) => 'order:' + JSON.stringify([id, market]);
export class Service {
  constructor(private store: Store) {}
  async directory() {
    const record = await this.store.get(directory.DIRECTORY_KEY);
    return { record, data: record ? record.payload as directory.Directory : directory.initial() };
  }
  async required(id: string) { const row = await this.store.get(id); if (!row) throw new StorageError('The requested record is not available. Confirm the reviewed data import has been completed.'); return row; }
  async get(path: string, query: URLSearchParams): Promise<Data> {
    if(path==='planning')return planning.combined(await this.store.list('workbook'),(await this.directory()).data);
    if (path === 'directory') { const {record,data}=await this.directory();return {directory:data,revision:record?.version??0,referenceOnly:!record,...directory.catalog()}; }
    if (path === 'campaign/catalog') {
      const {data}=await this.directory(),result=campaigns.catalog();
      result.catalog.client={id:'epic3',name:data.clients.find(c=>c.id==='epic3')?.name??'Epic3'};
      result.catalog.clients=data.clients;
      result.draft=campaigns.calculate(directory.campaignClient(campaigns.defaults(),data));
      return result;
    }
    if (path === 'campaign-order/options') return OPTIONS;
    if (path === 'campaigns') return { campaigns: (await this.store.list('campaign')).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map(r=>({ id:r.payload.id, name:r.payload.name, clientId:r.payload.clientId==='weed-man'?'epic3':r.payload.clientId,year:r.payload.year, updatedAt:r.updated_at })) };
    if (path === 'campaign') return campaigns.calculate(directory.campaignClient((await this.required(campaignKey(query.get('id') ?? ''))).payload,(await this.directory()).data));
    if (path === 'campaign-order') {
      const id = query.get('campaign') ?? '', market = query.get('market') ?? '';
      const saved = await this.store.get(orderKey(id, market));
      if (saved) return campaignOrders.model(saved.payload.source, saved.payload.details, saved.payload.revision);
      const c = await this.required(campaignKey(id)); return campaignOrders.model(campaignOrders.source(directory.campaignClient(c.payload,(await this.directory()).data), market), campaignOrders.defaults(), 0);
    }
    const w = (await this.required('workbook')).payload as Workbook;
    if (path === 'table') return workbook.snapshot(w);
    if (path === 'markets') return workbook.snapshot(w, query.get('sheet') ?? 'Markets');
    if (path === 'order') return orders.snapshot(w, query.get('market') ?? '8');
    throw new Error('Unknown service route.');
  }
  async post(path: string, payload: Data): Promise<Data> {
    if(path==='planning/cell'||path==='planning/formula') {
      check(typeof payload.workbookId==='string'&&typeof payload.clientId==='string','Choose a client workbook.');
      const record=await this.required(payload.workbookId);
      check(planning.owner(record)===payload.clientId,'The selected cell does not belong to this client. Reload the grid.');
      check((await this.directory()).data.clients.some(c=>c.id===payload.clientId),'Choose a registered client.');
      if(payload.storageVersion!==record.version)throw new Conflict('This client workbook changed in another window. Reload before saving.');
      workbook.edit(record.payload as Workbook,path==='planning/cell'?'cell':'formula',{address:payload.address,text:payload.text,revision:payload.revision,sheet:'EPIC3'});
      await this.store.save(record.id,'workbook',record.payload,record.version);
      return this.get('planning',new URLSearchParams());
    }
    if (path === 'directory/entity') {
      const {record,data}=await this.directory();
      check(Number.isSafeInteger(payload.revision)&&payload.revision>=0,'Invalid directory revision.');
      if(payload.revision!==(record?.version??0))throw new Conflict('The directory changed in another window. Reload before saving.');
      const result=directory.update(data,payload.collection,payload.entity);
      await this.store.save(directory.DIRECTORY_KEY,'directory',result.directory,record?.version??0);
      return {entity:result.entity,revision:(record?.version??0)+1};
    }
    if (path === 'campaign/preview') return campaigns.calculate(directory.campaignClient(payload,(await this.directory()).data));
    if (path === 'campaign') {
      const {record:directoryRecord,data}=await this.directory();
      const result = campaigns.calculate(directory.campaignClient(payload,data)), d = result.details;
      const current = d.id ? await this.required(campaignKey(d.id)) : null;
      if(!current||current.payload.clientId!==d.clientId&&!(current.payload.clientId==='weed-man'&&d.clientId==='epic3'))check(data.clients.some(c=>c.id===d.clientId&&c.active),'Choose an active client.');
      if (d.revision !== (current?.payload.revision ?? 0)) throw new Conflict('This campaign changed in another window. Reopen it before saving.');
      d.id ??= randomUUID(); d.revision++;
      await this.store.save(campaignKey(d.id), 'campaign', d, current?.version ?? 0, directoryRecord??undefined); return result;
    }
    if (path.startsWith('campaign-order')) {
      check(typeof payload.campaignId === 'string' && typeof payload.marketId === 'string', 'Choose a campaign and market.');
      const key = orderKey(payload.campaignId, payload.marketId), saved = await this.store.get(key), c = await this.required(campaignKey(payload.campaignId));
      const {data}=await this.directory();
      const clean=campaignOrders.clean(payload.details);
      for(const line of clean.broadcast)if(line.vendor)line.vendor=directory.vendorSnapshot(line.vendor,data,directory.channelMedia(line.channel)!,saved?.payload.details.broadcast.find((l:Data)=>l.id===line.id)?.vendor);
      for(const [channel,line] of Object.entries(clean.mediaDetails) as [string,Data][])if(line.vendor)line.vendor=directory.vendorSnapshot(line.vendor,data,directory.channelMedia(channel)??'',saved?.payload.details.mediaDetails[channel]?.vendor);
      const result = campaignOrders.preview({...payload,details:clean}, saved?.payload ?? null, directory.campaignClient(c.payload,data));
      if (path.endsWith('/preview')) return result;
      if (payload.refresh && result.sourceRevision !== payload.sourceRevision) throw new Conflict('The campaign changed again. Refresh before saving.');
      result.revision++;
      await this.store.save(key, 'campaign_order', { revision:result.revision, details:result.details, source:result.source }, saved?.version ?? 0, payload.refresh || !saved ? c : undefined);
      return result;
    }
    const record = await this.required('workbook'), w = record.payload as Workbook;
    if (path === 'order/preview') return orders.snapshot(w, payload.market, payload.details);
    const result = path === 'order' ? orders.save(w, payload) : workbook.edit(w, path as 'cell'|'formula'|'variable', payload);
    await this.store.save('workbook', 'workbook', w, record.version); return result;
  }
  async report() {
    const manifest = (await this.required('reporting')).payload;
    const chunks = await this.store.list('report_chunk');
    check(chunks.length === manifest.chunkCount, 'Reporting import is incomplete.');
    const records = chunks.flatMap(c => c.payload.records);
    check(records.length === manifest.recordCount, 'Reporting import is incomplete.');
    return { ...manifest.snapshot, records };
  }
}
