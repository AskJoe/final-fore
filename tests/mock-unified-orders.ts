import { randomUUID } from 'node:crypto';
import { campaignKey } from '../lib/service';
import type { OrderArchive } from '../lib/orders/archive-source';
import { marketOrderKey } from '../lib/orders/market-order';
import type { Calendar, DeadlineStep, OrderDetail, OrderLine } from '../lib/orders/store';
import type { ResearchState } from '../lib/order-assistant/types';
import type { MemoryStore } from './memory-store';

export const browserOrders = {
  secret: 'local-browser-orders-fixture',
  clientId: 'epic3',
  year: 2027,
  marketId: 'epic3-austin',
  campaignId: 'a0000000-0000-4000-8000-000000000001',
  orderId: 'a0000000-0000-4000-8000-000000000002',
  calendarId: 'a0000000-0000-4000-8000-000000000003',
  orderNumber: 'BROWSER-AUSTIN-27',
};

export const browserOrderArchive: OrderArchive = {
  version: 1, year: 2026, orders: [], files: {}, marketIds: {}, coverage: [], coverageYear: null,
};

export async function mockUnifiedOrders(store: MemoryStore) {
  const { clientId, year, marketId, campaignId, orderId, calendarId, orderNumber } = browserOrders;
  const saved = (await store.list('campaign_order')).find(row =>
    row.payload.source.marketId === marketId && row.payload.source.year === year);
  if (!saved) throw new Error('The browser import must contain the saved historical Austin order.');
  const legacyCampaignId: string = saved.payload.source.campaignId;
  const legacy = await store.get(campaignKey(legacyCampaignId));
  if (!legacy) throw new Error('The browser import must contain the historical campaign for that order.');
  const market = { marketId, region: 'South', start: '', end: '', override: 400_000, channels: { r3: 20_000 } };
  const start = '2027-02-22', end = '2027-05-16', updatedAt = '2026-11-26T14:00:00Z';
  await store.save(campaignKey(campaignId), 'campaign', {
    id: campaignId, revision: 1, name: legacy.payload.name, workflow: 'broadcast',
    clientId, year, start, end, budget: 400_000, markets: [market], regions: {},
  }, 0);

  const placement: Omit<OrderLine, 'id' | 'media' | 'station' | 'program' | 'amount'> = {
    marketId, start, end, format: '', days: 'M–F', rate: null, quantity: null, impressions: null, noCharge: false, notes: '',
  };
  let order: OrderDetail = {
    id: orderId, clientId, year, marketIds: [marketId], workflow: 'broadcast', originKey: marketOrderKey(clientId, year, marketId),
    revision: 1, number: orderNumber, vendor: '', firmId: null, repId: null, media: ['TV', 'Digital'],
    updatedAt, currentIssue: null, downloaded: false, sent: false, issues: [], history: [], seed: null,
    document: {
      number: orderNumber, date: '', clientName: 'Topco', vendor: '', rep: '', buyer: '', buyerEmail: '',
      billing: '', terms: '', start, end, notes: '', lines: [
        { ...placement, id: 'fixture-tv', media: 'TV', station: 'Fixture TV', program: 'Evening news', amount: 100_000 },
        { ...placement, id: 'fixture-digital', media: 'Digital', station: '', program: 'Streaming audio', amount: 200_000, feeBasisPoints: 1500 },
      ],
    },
  };
  const calendar: Calendar = {
    id: calendarId, clientId, year, name: 'Browser campaign calendar', revision: 1,
    deadlines: (['tv', 'radio', 'digital'] satisfies DeadlineStep[]).map((step, i) => ({
      id: 'a0000000-0000-4000-8000-00000000001' + i,
      calendarId, marketId, step, revision: 1, dueDate: start, statusOverride: null,
      orderIds: [orderId], legacyRefs: [], copySentAt: null, status: 'In progress',
    })),
  };
  let research: ResearchState = { orderId, revision: 0, shortlist: {}, viewRevision: 0, view: null, recovery: null };
  const contexts = new Map<string, Record<string, unknown>>();
  const proposals = new Map<string, Record<string, unknown>>();
  const conversations = new Map<string,string>();
  const reply = (value: unknown, status = 200) => ({ value, status });
  const orderPaths = new Set(['/rest/v1/ff_order_drafts', '/rest/v1/ff_order_assistant_proposals',
    '/rest/v1/rpc/ff_orders_workspace', '/rest/v1/rpc/ff_orders_detail',
    '/rest/v1/rpc/ff_order_state_command', '/rest/v1/rpc/ff_orders_command',
    '/rest/v1/ff_order_assistant_contexts', '/rest/v1/rpc/ff_order_assistant_versions', '/rest/v1/rpc/ff_order_assistant_bind_chat']);

  function serviceRequest(url: URL, method: string | undefined, key: string | undefined, input: Record<string, any>) {
    if (!orderPaths.has(url.pathname)) return undefined;
    if (key !== browserOrders.secret) return reply({ message: 'Orders fixture requires service access' }, 403);
    const params = url.searchParams;
    switch (url.pathname) {
      case '/rest/v1/ff_order_drafts': {
        const scope = params.get('client_id') === 'eq.' + clientId && params.get('year') === 'eq.' + year
          && params.get('workflow') === 'eq.broadcast';
        const origin = params.get('origin_key');
        if (params.get('select') === 'id') return reply(scope && origin === 'eq.' + order.originKey ? [{ id: orderId }] : []);
        if (params.get('select') === 'origin_key,market_ids,lines:document->lines') {
          const keys = origin?.slice(4, -1).split(',') ?? [];
          return reply(scope && origin?.startsWith('in.(') && keys.includes(order.originKey!) ?
            [{ origin_key: order.originKey, market_ids: order.marketIds, lines: order.document.lines }] : []);
        }
        return reply({ message: 'Unexpected Orders fixture query' }, 400);
      }
      case '/rest/v1/rpc/ff_orders_workspace': {
        const inScope = input.p_client_id === clientId && input.p_year === year;
        return reply(inScope ? { calendars: [calendar], orders: [order] } : { calendars: [], orders: [] });
      }
      case '/rest/v1/rpc/ff_orders_detail':
        return reply(input.p_id === orderId ? order : null);
      case '/rest/v1/rpc/ff_order_state_command':
        if (input.p_order !== orderId) return reply({ code: 'PT404', message: 'Order not found' }, 404);
        if (input.p_action === 'get') return reply(research);
        if (input.p_action === 'view') {
          const change = input.p_input;
          if (change.expectedRevision !== research.viewRevision) return reply({ code: 'PT409', message: 'Stale view' }, 409);
          research = { ...research, view: change.view, recovery: change.recovery, viewRevision: research.viewRevision + 1 };
          return reply(research);
        }
        return reply({ message: 'Unexpected order state action' }, 400);
      case '/rest/v1/rpc/ff_orders_command': {
        const change = input.p_input;
        if (input.p_action !== 'saveOrder' || change?.id !== orderId) return reply({ message: 'Unexpected order save' }, 400);
        if (change.expectedRevision !== order.revision) return reply({ code: 'PT409', message: 'Stale order' }, 409);
        order = { ...order, document: change.document, vendor: change.document.vendor, revision: order.revision + 1 };
        return reply(order);
      }
      case '/rest/v1/ff_order_assistant_proposals': {
        if (method==='POST') {
          if (!contexts.has(input.context_id) || input.order_id!==orderId) return reply({message:'Unknown proposal context'},400);
          proposals.set(input.id,input);
          return reply(null,201);
        }
        const matching=[...proposals.values()].filter(row=>['user_id','order_id','operation_id','id'].every(
          key=>!params.has(key)||params.get(key)==='eq.'+row[key]));
        return reply(matching.map(row=>({proposal:row.proposal})));
      }
      case '/rest/v1/rpc/ff_order_assistant_bind_chat': {
        const context=contexts.get(input.p_context);
        if (!context || context.user_id!==input.p_actor) return reply({message:'Context not found'},404);
        const key=input.p_actor+':'+input.p_session;
        const section=context.order_id+':'+context.edit_section;
        if (conversations.has(key)&&conversations.get(key)!==section) return reply({code:'PT409',message:'Chat already bound'},409);
        conversations.set(key,section);
        return reply(null);
      }
      case '/rest/v1/rpc/ff_order_assistant_versions':
        return input.p_market === marketId ? reply({directory: 1, sheets: [], reviews: []}) : reply({message:'Unknown market'}, 400);
      case '/rest/v1/ff_order_assistant_contexts': {
        if (method === 'POST') {
          if (input.order_id !== orderId || !['broadcast','digital'].includes(input.edit_section)) {
            return reply({message:'Expected a section-scoped order context'}, 400);
          }
          const id = randomUUID();
          contexts.set(id,{...input,id,detached:false,expires_at:new Date(Date.now()+3600_000).toISOString()});
          return reply({id},201);
        }
        const id=params.get('id')?.slice(3)??'';
        const existing=contexts.get(id);
        if (!existing || params.get('user_id')!== 'eq.'+existing.user_id) return reply([]);
        if (method==='PATCH') {
          contexts.set(id,{...existing,detached:input.detached});
          return reply(null);
        }
        return reply([existing]);
      }
      default:
        return undefined;
    }
  }
  return { legacyCampaignId, serviceRequest };
}
