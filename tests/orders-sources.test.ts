import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { workbookView } from '../lib/broadcast/view';
import type { ResearchSheet } from '../lib/broadcast/workbook';
import { initial } from '../lib/domain/directory';
import { validateOrderArchive, type ArchiveFile, type ArchiveLine, type ArchiveRecord, type OrderArchive } from '../lib/orders/archive-source';
import { archiveOrderSeed, broadcastOrderResearch, orderOpportunities, orderResearch, searchOrderArchive } from '../lib/orders/sources';
import { attestLine, verifyDraftSources } from '../lib/orders/provenance';
import { cleanOrderDocument, orderTotal, type OrderLine } from '../lib/orders/store';

const clientId = 'epic3';
const scope = { clientId, year: 2027 };
const arkansas = 'epic3-arkansas-nwa';
const austin = 'epic3-austin';
const boston = 'epic3-boston';
const directory = initial();

function file(id: string, kind = 'Signed order'): ArchiveFile {
  return { id, name: 'Fixture archive ' + id, kind, url: 'https://drive.google.com/file/d/' + id + '/view',
    revision: 'V2', signedOn: kind === 'Signed order' ? '2026-02-02' : '', market: 'Arkansas NWA',
    marketId: arkansas, rep: 'Allie Zimmermann', firm: 'iHeart', changed: '2026-02-05' };
}
function placement(options: Partial<ArchiveLine> = {}): ArchiveLine {
  return { row: 17, tab: 'Broadcast', flight: '3/9/26-5/3/26', kind: 'Placement', amount: 1280,
    impressions: '147,200', medium: 'Radio', station: 'KIGL-FM', placement: 'M-F 10A-3P', rate: '$20.00', spots: '64',
    days: 'M-F', weeks: '8', note: '', area: '', client: '', fmt: ':30', context: '', ...options };
}
function record(id: string, options: Partial<ArchiveRecord> = {}): ArchiveRecord {
  return { id, market: 'Arkansas NWA', name: 'Fixture order ' + id, type: 'Vendor order', issued: '2/2/2026', ref: 'Ref-' + id,
    client: 'EPIC3', media: 'Radio', amount: 1280, basis: 'Printed order total', imps: '147,200',
    targets: [], lines: [placement()], source: id, version: 'V2', signed: id, signedOn: '2026-02-02', signedBy: '',
    note: '', related: [], ...options };
}
function fixture(): OrderArchive {
  const digital = placement({medium:'Digital',tab:'Digital',station:'',placement:'Streaming audio',rate:'',spots:'',amount:250});
  return {
    version: 1, year: 2026, orders: [
      record('56'),
      record('55', {name:'A distinct station order',lines:[placement({station:'KKIX-FM'})]}),
      record('54', {source:'54', signed:'211'}),
      record('26', {source:'23', signed:'23', market:'Boston', type:'Market purchase order', amount:250, lines:[digital]}),
      record('41', {source:'200', signed:'200', market:'Shared · Weather', type:'Shared purchase order', amount:500,
        targets:['Austin','Boston'], lines:[{...digital,target:'Austin'},{...digital,target:'Boston'}]}),
      record('58', {media:'Digital',amount:250, lines:[digital]}),
    ],
    files: Object.fromEntries(['56','55','54','211','23','200','58'].map(id => [id, file(id,id === '54' ? 'Order workbook' : 'Signed order')])),
    marketIds: {'Arkansas NWA':arkansas,Austin:austin,Boston:boston},
    coverage: [], coverageYear: null,
  };
}

test('archived orders preserve the latest and signed documents independently', () => {
  const archive = validateOrderArchive(fixture());
  const result = searchOrderArchive(archive, directory, {clientId,year:2026,marketId:arkansas,q:'Ref-54'});
  assert.equal(result.total,1);
  assert.equal(result.orders[0].latest.id,'54');
  assert.equal(result.orders[0].signed?.id,'211');
  assert.equal(result.orders[0].lines[0].amount,128000);
  assert.equal(result.orders[0].seedAvailable,false);
  assert.equal(searchOrderArchive(null,directory,{clientId}).availability,'unconfigured');
  const invalid = fixture();
  invalid.files['54'].url = 'https://example.com/unreviewed';
  assert.throws(() => validateOrderArchive(invalid), /source file/);
});

test('seeding isolates station originals and keeps historical terms as reference', () => {
  const archive = fixture();
  const order = { ...scope, archiveId:'56', workflow:'broadcast' as const, marketIds:[arkansas] };
  const seeded = archiveOrderSeed(archive, directory, order);
  assert.equal(seeded.lines.length,1);
  assert.equal(seeded.lines[0].station,'KIGL-FM');
  assert.equal(seeded.lines[0].rate,2000);
  assert.equal(seeded.lines[0].quantity,64);
  assert.equal(seeded.lines[0].start,'');
  assert.match(seeded.lines[0].source?.locator ?? '', /3\/9\/26-5\/3\/26/);
  assert.equal(seeded.header.number,'');
  assert.equal(orderTotal(cleanOrderDocument({...seeded.header,lines:seeded.lines}, order)),128000);
  assert.throws(() => archiveOrderSeed(archive,directory,{...order,archiveId:'54'}), /exact client and market/);
  assert.throws(() => archiveOrderSeed(archive,directory,{...order,marketIds:[austin]}), /exact client and market/);
  assert.throws(() => archiveOrderSeed(archive,directory,{...order,workflow:'digital'}), /unavailable/);
  assert.throws(() => archiveOrderSeed(archive,directory,{...order,year:2026}), /unavailable/);
  const opportunities = orderOpportunities(archive,directory,scope);
  assert.equal(opportunities.find(row => row.archiveId === '56')?.rep,'Allie Zimmermann');
  assert.equal(opportunities.find(row => row.archiveId === '55')?.title,'A distinct station order');
  assert.equal(opportunities.find(row => row.workflow === 'digital' && row.marketId === arkansas)?.archiveId,null);
});

test('a group seed uses its exact participating markets and only one document allocation', () => {
  const archive = fixture();
  archive.billing = {'41':{number:'Prior invoice',year:2025,issued:'2025-02-10',amount:19_000_000,
    sources:[{label:'Invoice register',url:'https://docs.google.com/spreadsheets/d/test/edit'}]}};
  const opportunities = orderOpportunities(archive,directory,scope);
  const local = opportunities.find(row => row.workflow === 'digital' && row.marketIds.length === 1 && row.marketId === boston);
  const grouped = opportunities.find(row => row.archiveId === '41');
  assert.equal(local?.archiveId,'26');
  assert.equal(grouped?.title,'EPIC3 Weather V6');
  assert.notEqual(local?.key,grouped?.key);
  const data = {...scope,archiveId:'41',workflow:'digital' as const,marketIds:[austin,boston]};
  const draft = archiveOrderSeed(archive,directory,data);
  assert.deepEqual(draft.lines.map(line => line.marketId),[austin,boston]);
  assert.equal(orderTotal(cleanOrderDocument({...draft.header,lines:draft.lines},data)),50000);
  assert.equal(draft.source.billing?.amount,19_000_000);
  assert.throws(() => archiveOrderSeed(archive,directory,{...data,marketIds:[boston]}), /exact client and market/);
});

test('a copied source remains valid through manual edits, but does not cross scopes or tolerate altered evidence', () => {
  const key = 'only-a-test-key';
  const order = {...scope,workflow:'digital' as const,marketIds:[arkansas,boston]};
  const line: OrderLine = { id:'research-1',marketId:arkansas,media:'Digital',program:'Streaming audio',
    station:'',format:'',days:'',start:'',end:'',rate:null,quantity:null,amount:null,impressions:null,noCharge:false,notes:'',
    source:{kind:'digital',id:'catalog-r8',label:'Channel catalog',locator:'IO8',year:2026} };
  const research = attestLine(line,order,key);
  const working = {...research,id:'new-placement',notes:'Media approved by buyer',amount:12300};
  assert.doesNotThrow(() => verifyDraftSources({lines:[working]},order,key));
  assert.throws(() => verifyDraftSources({lines:[{...working,marketId:boston}]},order,key),/could not be verified/);
  assert.throws(() => verifyDraftSources({lines:[working]},{...order,clientId:'Another client'},key),/could not be verified/);
  assert.throws(() => verifyDraftSources({lines:[working]},{...order,workflow:'broadcast'},key),/could not be verified/);
  assert.throws(() => verifyDraftSources({lines:[working]},{...order,year:2028},key),/could not be verified/);
  assert.throws(() => verifyDraftSources({lines:[{...working,source:{...working.source,locator:'IO9'}}]},order,key),
    /could not be verified/);
  assert.throws(() => verifyDraftSources({lines:[{...working,source:false}]},order,key),/order’s market/);
  const saved = cleanOrderDocument({lines:[working]},order);
  assert.equal('attestation' in saved.lines[0].source!,false);
  assert.doesNotThrow(() => verifyDraftSources(saved,order,'rotated-key',saved));
  assert.doesNotThrow(() => verifyDraftSources(saved,order,'rotated-key',null,saved));
  assert.throws(() => verifyDraftSources(saved,order,key),/could not be verified/);
});

test('shared archive lines are client-scoped, including links to mixed originals', () => {
  const archive = fixture();
  const steve = 'steve-minneapolis';
  const clients = structuredClone(directory);
  clients.clients.push({id:'steve',marketIds:[steve],name:'Weed Man Steve',active:true});
  archive.marketIds.Minneapolis = steve;
  archive.files['99'] = file('99');
  archive.orders.push(record('99',{market:'Shared placement', targets:['Boston','Minneapolis'], amount:2500,
    lines:[placement({target:'Boston',placement:'For EPIC3'}),placement({target:'Minneapolis',client:'Weed Man Steve - MN',placement:'For Steve'})]}));
  const results = searchOrderArchive(archive,clients,{clientId:'steve',marketId:steve}).orders;
  assert.equal(results.length,1);
  assert.deepEqual(results[0].lines.map(line => line.program),['For Steve']);
  assert.equal(results[0].latest.url,undefined);
  assert.equal(results[0].amount,null);
  assert.throws(() => searchOrderArchive(archive,clients,{clientId,marketId:steve}), /assigned to this client/);
});

test('standalone digital uses the channel workbook while station digital uses placement history', () => {
  const archive = fixture();
  const digital = orderResearch(archive,directory,{...scope,marketId:arkansas,workflow:'digital',sheet:'digital'});
  assert.equal(digital.total,20);
  const row = digital.rows.find(item => item.program === 'iHeart Streaming Radio/Audio')!;
  assert.match(row.source?.locator ?? '',/IO8/);
  assert.equal(row.cells[4] && typeof row.cells[4] === 'object' ? row.cells[4].value : null,5000);
  assert.equal(row.cells[7] && typeof row.cells[7] === 'object' ? row.cells[7].value : null,312500);
  assert.equal(row.line?.amount,null);
  assert.equal(row.line?.source?.kind,'digital');
  const station = orderResearch(archive,directory,{...scope,marketId:arkansas,workflow:'broadcast',sheet:'station-history'});
  assert.deepEqual(station.rows.map(item => item.line?.source?.id),['58']);
  assert.throws(() => orderResearch(archive,directory,{...scope,marketId:arkansas,workflow:'digital',sheet:'station-history'}),
    /matches this order workflow/);
});

test('Broadcast Research retains market attribution, exact source row and selected quote dates', async () => {
  const source = {id:'rate-sheet-arkansas',name:'Rate sheet',market:'Arkansas NWA',marketId:arkansas,rep:'Rep',firm:'Firm'};
  const quote = {value:100,unit:'USD',locator:'Quote!B2',raw:'100'};
  const row = {id:'arkansas-tv',market:'Arkansas NWA',sourceMarketId:arkansas,client:'EPIC3',
    sourceKeys:['source'],locator:'Quote!A2',cells:['KFSM','Morning News',quote],
    pricePeriods:[{start:'2027-03-01',through:'2027-03-07',rate:quote}]};
  const sheet: ResearchSheet = {
    columns:['Station','Program','Spot rate'].map(label => ({label,width:80})),
    rows:[row,{...row,id:'unreviewed',issue:{key:'issue',sourceMarket:'Unknown',candidates:[arkansas]}}],
    sources:{source:{files:[source]}},totals:{values:4,files:1,submissions:1},
  };
  const result = await broadcastOrderResearch(directory,{...scope,marketId:arkansas,workflow:'broadcast',sheet:'tv',rep:'Rep'},
    async (name,query) => ({view:workbookView(name,sheet,[],query),reviews:[]}));
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].line,null);
  assert.equal(result.rows[0].periods?.[0].line.rate,10000);
  assert.equal(result.rows[0].periods?.[0].line.start,'2027-03-01');
  assert.equal(result.rows[0].periods?.[0].line.source?.locator,'Quote!B2');
  assert.equal(result.rows[1].periods,undefined);
});

test('Broadcast Research search and numeric sort reach later pages inside the same market', async () => {
  const source = {id:'rate-sheet-arkansas',name:'Rate sheet',market:'Arkansas NWA',marketId:arkansas,rep:'Rep',firm:'Firm'};
  const sheet: ResearchSheet = {
    columns:['Station','Daypart','Spot rate','Gross impressions'].map(label => ({label,width:80})),
    rows: Array.from({length:103},(_, index) => ({
      id:'radio-' + index, market:'Arkansas NWA', sourceMarketId:arkansas, client:'EPIC3',
      sourceKeys:['source'], cells:['KEZA-FM',index === 102 ? 'Target daypart' : 'Daypart ' + index,index + 10,index * 100],
    })),
    sources:{source:{files:[source]}},totals:{values:412,files:1,submissions:1},
  };
  const requests: {page:number;primary:string;market:string}[] = [];
  const query = {...scope,marketId:arkansas,workflow:'broadcast' as const,sheet:'radio',primary:'rep'};
  const load: Parameters<typeof broadcastOrderResearch>[2] = async (name,params) => {
    requests.push({page:params.page,primary:params.grouping.primary,market:params.filters.market});
    return {view:workbookView(name,sheet,[],params),reviews:[]};
  };
  const unfiltered = await broadcastOrderResearch(directory,query,load);
  assert.deepEqual(requests.splice(0),[{page:1,primary:'Rep',market:'Arkansas NWA'}]);
  assert.equal(unfiltered.rows.length,100);
  assert.equal(unfiltered.pageCount,2);
  const matched = await broadcastOrderResearch(directory,{...query,q:'Target daypart'},load);
  assert.deepEqual(requests.splice(0).map(item => item.page),[1,2]);
  assert.equal(matched.total,1);
  assert.equal(matched.rows[0].id,'radio-102');
  const sorted = await broadcastOrderResearch(directory,{...query,sort:'impressions'},load);
  assert.equal(sorted.total,103);
  assert.equal(sorted.rows[0].id,'radio-102');
  assert.equal(sorted.rows[1].id,'radio-101');
});

test('published market and party labels resolve to canonical order scope without crossing source IDs', async () => {
  const source = {id:'released-sheet',name:'Released station rates',market:'Bentonville/Fayetteville, AR',
    marketId:arkansas,rep:'Allie Zimmermann',firm:'iHeartMedia'};
  const common = { sourceMarketId:arkansas, client:'EPIC3', sourceKeys:['source'], cells:['KEZA-FM','Morning'] };
  const sheet: ResearchSheet = {
    columns: ['Station','Daypart'].map(label => ({label,width:80})),
    rows: [
      {...common,id:'reviewed-market-alias',market:'Bentonville/Fayetteville, AR'},
      {...common,id:'another-market-alias',market:'FAYETTEVILLE, AR'},
      {...common,id:'wrong-source-scope',market:'Bentonville/Fayetteville, AR',sourceMarketId:austin},
    ],
    sources: {source:{files:[source]}}, totals:{values:6,files:1,submissions:1},
  };
  const filtered: Parameters<Parameters<typeof broadcastOrderResearch>[2]>[1]['filters'][] = [];
  const result = await broadcastOrderResearch(directory,{...scope,marketId:arkansas,workflow:'broadcast',
    sheet:'radio',rep:'allie zimmermann',firm:'iHeart'},async (name,params) => {
    filtered.push(params.filters);
    return {view:workbookView(name,sheet,[],params),reviews:[]};
  });
  assert.deepEqual(filtered.map(item => item.market),['Arkansas NWA','Bentonville/Fayetteville, AR','FAYETTEVILLE, AR']);
  assert.equal(filtered[1].firm,'iHeartMedia');
  assert.equal(filtered[2].rep,'Allie Zimmermann');
  assert.deepEqual(result.rows.map(row => row.id),['reviewed-market-alias','another-market-alias']);
  assert.equal(result.total,2);
  assert.equal(result.rows[0].market,'Arkansas NWA');
  assert.equal(result.rows[0].source?.id,'released-sheet');
});
