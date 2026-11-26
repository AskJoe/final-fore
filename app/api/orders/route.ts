import { createHash } from 'node:crypto';
import { AccessError, requireMember } from '@/lib/access';
import { MARKETS } from '@/lib/domain/catalogs';
import type { Directory } from '@/lib/domain/directory';
import { check, Conflict, object, today, type Data } from '@/lib/domain/types';
import { failure, json, privateHeaders, sameOrigin } from '@/lib/http';
import { ORDER_PDF_VERSION, renderOrderPdf } from '@/lib/orders/pdf';
import { isMarketOrder, marketOrderKey } from '@/lib/orders/market-order';
import { orderMediaTotals } from '@/lib/orders/metrics';
import { attestLine, verifyDraftSources } from '@/lib/orders/provenance';
import { archiveOrderSeed, loadOrderArchive, marketBroadcastHistory, orderOpportunities, searchOrderArchive, type ResearchQuery } from '@/lib/orders/sources';
import { cleanOrderDocument, orderStore, orderTotal, validateOrderForIssue, type OrderAction, type OrderDocument, type OrderLine } from '@/lib/orders/store';
import { campaignKey, orderKey, Service } from '@/lib/service';
import { StorageError } from '@/lib/store';
import { orderRuntime as context, ordersSecret } from '@/lib/orders/runtime';
import { loadOrderResearch } from '@/lib/orders/research-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bucket = 'ff-order-pdfs';
const commands = new Set<OrderAction>([
  'saveOrder', 'saveCalendar', 'saveDeadline', 'saveMarketDeadlines', 'recordCopySend', 'createRevision', 'reviseOrder',
  'restoreRevision', 'recordSend', 'correctSend', 'finalizeOrder', 'recordDownload',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const marketNames = Object.fromEntries(Object.entries(MARKETS).map(([id, market]) => [id, String(market.name)]));
const hash = (bytes: ArrayBuffer | Uint8Array) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

function findClient(directory: Directory, clientId: unknown) {
  const client = directory.clients.find(client => client.id === clientId);
  check(client, 'Choose a client from the directory.');
  return client;
}
function ensureMarket(client: Data, marketId: unknown): asserts marketId is string {
  check(typeof marketId === 'string' && Object.hasOwn(MARKETS, marketId) && client.marketIds.includes(marketId),
    'Choose a market assigned to this client.');
}
function yearNumber(value: unknown) {
  const year = Number(value);
  check(Number.isInteger(year) && year >= 2000 && year <= 2100, 'Enter an order year from 2000 to 2100.');
  return year;
}
function requireId(value: unknown): asserts value is string {
  check(typeof value === 'string' && uuid.test(value), 'Invalid order or calendar reference.');
}
function workflowName(value: unknown): 'digital' | 'broadcast' {
  check(value === 'digital' || value === 'broadcast', 'Choose an order workflow.');
  return value;
}
function validStep(value: unknown) {
  return value === 'tv' || value === 'radio' || value === 'digital' || value === 'copy' ? value : undefined;
}
function stripPrivate(result: unknown): unknown {
  if (Array.isArray(result)) return result.map(stripPrivate);
  if (!object(result)) return result;
  return Object.fromEntries(Object.entries(result)
    .filter(([key]) => key !== 'storageKey' && key !== 'storage_key')
    .map(([key, value]) => [key, stripPrivate(value)]));
}

function legacySummary(record: Data, clientId: string, year: number) {
  const src = record.payload?.source;
  if (!src || (src.clientId === 'weed-man' ? 'epic3' : (src.clientId ?? 'epic3')) !== clientId ||
    Number(src.year) !== year || !src.campaignId || !src.marketId) return null;
  const details = record.payload.details ?? {};
  const media = [...new Set<string>([
    ...(details.broadcast ?? []).map((line: Data) => line.channel === 'r4' ? 'TV' : 'Radio'),
    ...(src.lines ?? []).filter((line: Data) => line.kind === 'digital').map(() => 'Digital'),
  ])];
  const params = new URLSearchParams({ campaign: src.campaignId, market: src.marketId });
  return {campaignId:src.campaignId, marketId:src.marketId, title:details.orderNumber || src.campaignName || 'Campaign order',
    clientId, year, media, href:'/orders.html?' + params.toString()};
}

async function seed(directory: Directory, input: Data) {
  const archive = await loadOrderArchive();
  const client = findClient(directory, input.clientId);
  const year = yearNumber(input.year);
  const requestedWorkflow = workflowName(input.workflow);
  check(!input.archiveId, 'Open the shared market order to use historical evidence.');
  const workflow = 'broadcast' as const;
  const marketId: unknown = input.marketId || input.marketIds?.[0];
  ensureMarket(client, marketId);
  check(!input.marketIds || Array.isArray(input.marketIds) && input.marketIds.length === 1 && input.marketIds[0] === marketId,
    'Choose one market per order.');
  const marketIds = [marketId];
  const originKey = marketOrderKey(client.id, year, marketId);
  const key = input.originKey || input.key;
  check(!key || key === originKey || requestedWorkflow === 'digital' &&
    key === ['digital', client.id, year, marketId].join('|'),
    'This order opportunity is no longer available. Reopen it before saving.');
  const history = archiveOrderSeed(archive, directory, {archiveId:'',workflow,clientId:client.id,year,marketIds});
  const scope = {clientId:client.id,year,workflow};
  const document: OrderDocument = {
    ...history.header,
    lines: history.lines.map(line => attestLine(line, scope, ordersSecret())),
  };
  return {document,...scope,marketIds,originKey,
    firmId:null,repId:null,archiveId:null,seed:history.source};
}

async function researchResponse(directory: Directory, params: URLSearchParams, memberClient: OrderContext['supabase'],
  { clientId, marketId, year }: { clientId: string; marketId: string; year: number },
  filters: Pick<ResearchQuery, 'selection' | 'shortlist'> = {}) {
  return json(await loadOrderResearch(directory,params,memberClient,{clientId,marketId,year},filters));
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const params = new URL(request.url).searchParams;
    const get = (key: string) => params.get(key) ?? '';
    const view = get('view') || (get('id') ? 'order' : 'workspace');
    if (view === 'issued-pdf') return await serveIssuedPdf(ctx, {id: get('id'), issueId: get('issueId')});
    if (view === 'order') {
      requireId(get('id'));
      const order = await ctx.orders.readOrder(get('id'));
      if (!order) throw new AccessError('Order not found.',404);
      return json(stripPrivate(order));
    }
    const {data:directory} = await ctx.share.directory();
    const clients = directory.clients.filter(client => client.active !== false)
      .map(client => ({id:String(client.id),name:String(client.name),marketIds:(client.marketIds ?? []) as string[]}));
    const date = today();
    const defaultYear = Number(date.slice(0,4)) + (Number(date.slice(5,7)) >= 10 ? 1 : 0);
    const year = yearNumber(get('year') || defaultYear);
    const clientId = get('clientId') || clients[0]?.id;
    if (!clientId && view === 'workspace') return json({clients:[],markets:[],calendars:[],orders:[],opportunities:[],legacyOrders:[],year});
    const client = findClient(directory, clientId);
    const marketId = get('marketId');
    if (marketId) ensureMarket(client, marketId);
    const marketDirectory = () => clients.flatMap(item => item.marketIds).filter(id => marketNames[id])
      .map(id => ({id,name:marketNames[id]}));
    if (view === 'campaign-budget') {
      const marketIds = (client.marketIds as string[]).filter(id => Object.hasOwn(marketNames, id));
      const origin = (id: string) => marketOrderKey(clientId, year, id);
      const [archive, drafts] = await Promise.all([
        loadOrderArchive(),
        marketIds.length ? ctx.admin.from('ff_order_drafts').select('origin_key, market_ids, lines:document->lines')
          .eq('client_id', clientId).eq('year', year).eq('workflow', 'broadcast').in('origin_key', marketIds.map(origin))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!archive) throw new StorageError('The broadcast order archive is unavailable.');
      if (drafts.error) throw new StorageError('Unable to load campaign order budgets.');
      const current = new Map((drafts.data as { origin_key: string; market_ids: string[]; lines: OrderLine[] }[])
        .filter(order => order.market_ids.length === 1).map(order => [order.origin_key, order.lines]));
      const amounts = marketIds.map(id=>{
        const previous=archiveOrderSeed(archive,directory,{archiveId:'',workflow:'broadcast',clientId,year,marketIds:[id]});
        const baseline=orderTotal({...previous.header,lines:previous.lines});
        const saved = current.get(origin(id));
        const totals = saved ? orderMediaTotals(saved) : null;
        const actual = totals ? totals.broadcast + totals.digital : null;
        return [id,{baseline,actual,broadcast:totals?.broadcast ?? null,digital:totals?.digital ?? null,placements:saved?.length ?? 0}] as const;
      });
      return json({priorYear:year>archive.year?archive.year:null,markets:Object.fromEntries(amounts)});
    }
    if (view === 'seed') {
      const campaignId=get('campaignId');
      const [draft, campaign] = await Promise.all([
        seed(directory,{clientId,year,marketId,workflow:get('workflow'),step:get('step'),key:get('key')||get('seed'),archiveId:get('archiveId')}),
        campaignId ? ctx.directoryStore.get(campaignKey(campaignId)) : null]);
      const existing = await ctx.admin.from('ff_order_drafts').select('id')
        .eq('client_id', clientId).eq('year', year).eq('workflow', draft.workflow).eq('origin_key', draft.originKey).maybeSingle();
      if (existing.error) throw new StorageError('Unable to look up the saved order.');
      const details=campaign?.payload;
      const market=details?.clientId===clientId&&details.year===year&&details.workflow===draft.workflow
        ? details.markets.find((item:Data)=>item.marketId===marketId) : undefined;
      if(market){
        const dates=details!.regions?.[market.region];
        draft.document.start=market.start||dates?.start||details!.start||'';
        draft.document.end=market.end||dates?.end||details!.end||'';
      }
      const marketProposed=market && !market.sharedBudgetMarketId ? (market.override ?? null) : undefined;
      const scope = get('includeScope') === '1' ? { clients, clientId, year, markets: marketDirectory(), orders: [], calendars: [], canEdit: true } : undefined;
      return json({...draft,marketProposed,scope,order:existing.data ? stripPrivate(await ctx.orders.readOrder(existing.data.id)) : null});
    }
    if (view === 'market-history') {
      const media = get('media');
      check(media === 'TV' || media === 'Radio', 'Choose TV or Radio history.');
      return json(marketBroadcastHistory(await loadOrderArchive(), directory, { clientId, marketId, media, year: year - 1 }));
    }
    if (view === 'archive') {
      const archive = await loadOrderArchive();
      return json(await searchOrderArchive(archive,directory,{clientId,marketId,year:Number(get('archiveYear') || (get('year') || '2026')),
        media:get('media'),q:get('q').slice(0,200),page:Number(get('page')||1),
        workflow:get('workflow'),rep:get('rep'),firm:get('firm'),sort:get('sort')}));
    }
    if (view === 'research') return await researchResponse(directory, params, ctx.supabase, {clientId,marketId,year});
    check(view === 'workspace','Unknown Orders view.');
    if (get('scope') === 'directory' || get('scope') === 'history') {
      const orders = get('scope') === 'history' ? (await ctx.orders.readWorkspace(clientId,year)).orders.filter(order=>!isMarketOrder(order)) : [];
      return json({clients,clientId,year,markets:marketDirectory(),orders,calendars:[],canEdit:true});
    }
    const [state,archive,legacy] = await Promise.all([
      ctx.orders.readWorkspace(clientId,year),loadOrderArchive().catch(() => null),ctx.directoryStore.list('campaign_order'),
    ]);
    return json({
      ...state,clients,clientId,year,
      markets:marketDirectory(),
      opportunities:await orderOpportunities(archive,directory,{clientId,year,marketWide:true}),
      legacyOrders:legacy.map(row=>legacySummary(row,clientId,year)).filter(row=>row&&client.marketIds.includes(row.marketId)),
      canEdit:true,
    });
  } catch(error) { return failure(error); }
}

type OrderContext = Awaited<ReturnType<typeof context>>;
async function pdfBytes(ctx: OrderContext, storageKey: string) {
  const {data,error} = await ctx.admin.storage.from(bucket).download(storageKey);
  if (error || !data) throw new StorageError('The issued PDF is unavailable. Try again.');
  return new Uint8Array(await data.arrayBuffer());
}

async function issuePdf(ctx: OrderContext, input: Data) {
  requireId(input.id);
  const draft = await ctx.orders.readOrder(input.id);
  if (!draft) throw new AccessError('Order not found.',404);
  check(Number.isSafeInteger(input.expectedRevision),'Reload the saved revision before finalizing.');
  if (draft.revision !== input.expectedRevision) throw new Conflict('This order changed. Reopen it before finalizing.');
  const previous = draft.issues.find(issue=>issue.revision === input.expectedRevision);
  if (previous) return json(stripPrivate(draft));
  const document = draft.document;
  check(draft.workflow !== 'digital', 'Open the shared market order to finalize Digital placements.');
  const clientOrder = isMarketOrder(draft);
  validateOrderForIssue(document, clientOrder);
  const storageKey = draft.id + '/' + draft.revision + '-' + ORDER_PDF_VERSION + '.pdf';
  const storage = ctx.admin.storage.from(bucket);
  const info = await storage.info(storageKey);
  if (!info.data) {
    const bytes = await renderOrderPdf(document, marketNames, clientOrder);
    await storage.upload(storageKey, bytes, {contentType:'application/pdf',upsert:false});
  }
  const persisted = await pdfBytes(ctx,storageKey);
  check(Buffer.from(persisted.subarray(0,5)).toString('ascii') === '%PDF-','The order PDF could not be verified.');
  return json(stripPrivate(await ctx.orders.command(ctx.user.id,'finalizeOrder',{
    id:draft.id,expectedRevision:draft.revision,operationId:input.operationId,
    artifact:{storageKey,sha256:hash(persisted),bytes:persisted.byteLength,templateVersion:ORDER_PDF_VERSION},
  })));
}

async function serveIssuedPdf(ctx: OrderContext, input: Data, download = false) {
  requireId(input.id);
  requireId(input.issueId);
  const order = await ctx.orders.readOrder(input.id);
  const issue = order?.issues.find(issue => issue.id === input.issueId);
  if (!order || !issue) throw new AccessError('Issued order not found.',404);
  if (!issue.storageKey) throw new StorageError('The issued PDF is unavailable. Try again.');
  const bytes = await pdfBytes(ctx,issue.storageKey);
  if (bytes.byteLength !== issue.bytes || hash(bytes) !== issue.sha256) throw new StorageError('The issued PDF failed its integrity check.');
  if (download) await ctx.orders.command(ctx.user.id,'recordDownload',{id:order.id,issueId:issue.id,operationId:input.operationId});
  const name = (issue.number || 'Media-Order').replace(/[^a-z0-9._-]+/gi,'-').slice(0,100);
  return new Response(bytes.buffer as ArrayBuffer,{headers:{...privateHeaders,'Content-Type':'application/pdf',
    'Content-Disposition':(download ? 'attachment' : 'inline') + '; filename="' + name + '-v' + issue.revision + '.pdf"'}});
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AccessError('This action must come from Final Fore.',403);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return json({error:'Expected JSON.'},415);
    }
    const ctx = await context();
    const limit=1_000_000;
    if (Number(request.headers.get('content-length')) > limit) return json({error:'This order is too large to save.'},413);
    const reader=request.body?.getReader();
    if (!reader) return json({error:'Expected a request body.'},400);
    const chunks:Uint8Array[]=[];
    let size=0;
    while (true) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>limit) {
        await reader.cancel();
        return json({error:'This order is too large to save.'},413);
      }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'research') {
      check(object(input) && (input.mode !== undefined || input.shortlist !== undefined), 'Choose a valid research selection.');
      const filters: Pick<ResearchQuery, 'selection' | 'shortlist'> = {};
      if (input.mode !== undefined) {
        check((input.mode === 'selected' || input.mode === 'unselected') && Array.isArray(input.keys)
          && input.keys.length <= 200 && input.keys.every((key: unknown) => typeof key === 'string' && key.length <= 4000),
        'Choose a valid research selection.');
        filters.selection = { mode: input.mode, keys: new Set<string>(input.keys) };
      }
      if (input.shortlist !== undefined) {
        const shortlist = input.shortlist;
        check(object(shortlist) && (shortlist.mode === 'shortlisted' || shortlist.mode === 'unshortlisted')
          && Array.isArray(shortlist.ids) && shortlist.ids.every((id: unknown) => typeof id === 'string' && id.length <= 400),
        'Choose a valid research shortlist.');
        filters.shortlist = { mode: shortlist.mode, ids: new Set<string>(shortlist.ids) };
      }
      const { data: directory } = await ctx.share.directory();
      return await researchResponse(directory, params, ctx.supabase, {
        clientId: params.get('clientId') ?? '', marketId: params.get('marketId') ?? '', year: yearNumber(params.get('year')),
      }, filters);
    }
    check(object(input) && commands.has(input.action),'Unknown Orders action.');
    requireId(input.operationId);
    const action = input.action;
    if (action === 'finalizeOrder') return await issuePdf(ctx,input);
    if (action === 'recordDownload') return await serveIssuedPdf(ctx,input,true);
    if (action === 'saveOrder') {
      let scope;
      if (input.id) {
        requireId(input.id);
        scope = await ctx.orders.readOrder(input.id);
        if (!scope) throw new AccessError('Order not found.',404);
        check(scope.workflow !== 'digital', 'Open the shared market order to edit Digital placements.');
      } else {
        scope = await seed((await ctx.share.directory()).data,input);
        const {clientId,year,workflow,marketIds,originKey,firmId,repId,seed:source} = scope;
        Object.assign(input,{clientId,year,workflow,marketIds,originKey,firmId,repId,seed:source});
      }
      verifyDraftSources(input.document,scope,ordersSecret(),input.id ? scope.document : null,
        input.id ? null : scope.document);
      input.document = cleanOrderDocument(input.document,scope);
    }
    if (action === 'createRevision' || action === 'reviseOrder' || action === 'restoreRevision') {
      requireId(input.id);
      const draft = await ctx.orders.readOrder(input.id);
      if (!draft) throw new AccessError('Order not found.',404);
      check(draft.workflow !== 'digital', 'Open the shared market order to edit Digital placements.');
    }
    if (action === 'saveCalendar') {
      const client = findClient((await ctx.share.directory()).data,input.clientId);
      check(client.active !== false,'Choose an active client to save this calendar.');
      input.year = yearNumber(input.year);
    }
    if (action === 'saveDeadline' || action === 'saveMarketDeadlines') {
      requireId(input.calendarId);
      const calendar = await ctx.orders.readCalendar(input.calendarId);
      if (!calendar) throw new AccessError('Calendar not found.',404);
      ensureMarket(findClient((await ctx.share.directory()).data,calendar.clientId),input.marketId);
      if (action === 'saveDeadline' && input.legacyRefs !== undefined) {
        check(Array.isArray(input.legacyRefs) && input.legacyRefs.length <= 30,'Too many linked orders.');
        input.legacyRefs = await Promise.all(input.legacyRefs.map(async (ref: Data)=>{
          check(object(ref) && typeof ref.campaignId === 'string' && ref.campaignId.length <= 80 && ref.marketId === input.marketId,
            'Choose a saved campaign order for this market.');
          const row = await ctx.directoryStore.get(orderKey(ref.campaignId,ref.marketId));
          const order = row ? legacySummary(row,calendar.clientId,calendar.year) : null;
          const step = validStep(input.step);
          check(order && step && (step === 'copy' || (step !== 'digital' && order.media.some(m => m.toLowerCase() === step))),
            'The linked order does not match this deadline.');
          return {campaignId:order.campaignId,marketId:order.marketId,title:order.title};
        }));
      }
    }
    return json(stripPrivate(await ctx.orders.command(ctx.user.id,action,input)));
  } catch(error) { return failure(error); }
}
