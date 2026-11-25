'use client';
import { canonicalJson } from '@/lib/domain/json';
import { isMarketOrder } from '@/lib/orders/market-order';
import { cleanOrderDocument } from '@/lib/orders/store';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deadline, OrderDetail, OrderSummary, OrderWorkflow, OrderWorkspace } from '@/lib/orders/store';
import { businessDate, OrderCalendar, displayTime, OrderFeedbackContext, type ClientOption, type MarketOption, type Mutate, type OrderAction } from './OrderCalendar';
import { HistoricalOrders, ordersJson, ordersUrl, useOrdersQuery, type OrderOpportunity } from './OrdersCatalog';
import { OrderEditor, type OpenOrder } from './OrderEditor';
import { OrderMenu } from './OrderToolbar';

export type LegacyOrder = {
  campaignId: string; marketId: string; title: string; year: number; clientId: string; media: string | string[]; href: string;
};
type Workspace = OrderWorkspace & {
  clients: ClientOption[]; markets: MarketOption[]; opportunities: OrderOpportunity[];
  legacyOrders?: LegacyOrder[]; canEdit?: boolean; clientId?: string; year?: number;
};
type OrderFilter = { market: string; query: string; status: string };
const emptyFilter: OrderFilter = { market: '', query: '', status: '' };

function orderStatus(order: OrderSummary) {
  return order.sent ? 'Sent' : order.currentIssue ? 'Finalized' : 'Draft';
}

function OrderList({ workflow, orders, opportunities, legacy, markets, filter, canEdit, onFilter, onOpen, onStart, title }: {
  workflow: OrderWorkflow; orders: OrderSummary[]; opportunities: OrderOpportunity[]; legacy: LegacyOrder[]; markets: MarketOption[]; title?: string;
  filter: OrderFilter; canEdit: boolean; onFilter: (patch: Partial<OrderFilter>) => void; onOpen: (id: string) => void;
  onStart: (market: string, workflow: OrderWorkflow, key?: string, archiveId?: string) => void;
}) {
  const marketName = (id: string) => markets.find(item => item.id === id)?.name ?? id;
  const search = filter.query.trim().toLowerCase();
  const matches = (values: (string | undefined | null)[]) => !search || values.join(' ').toLowerCase().includes(search);
  const active = orders.filter(order => order.workflow === workflow && (!filter.market || order.marketIds.includes(filter.market))
    && (!filter.status || orderStatus(order) === filter.status)
    && matches([order.number, ...order.marketIds.map(marketName), orderStatus(order)]));
  const older = workflow === 'broadcast' && !filter.status ? legacy.filter(order =>
    (!filter.market || order.marketId === filter.market) && matches([order.title, marketName(order.marketId)])) : [];
  const available = !filter.status ? opportunities.filter(item => item.workflow === workflow && (!filter.market || item.marketIds.includes(filter.market))
    && matches([item.title, item.firm, item.rep, marketName(item.marketId)])) : [];
  const shown = available.filter(item => !active.some(order =>
    order.originKey === item.key));
  const heading = title ?? (workflow === 'digital' ? 'Legacy Digital orders' : 'Order planning');

  return <section className="ow-order-list" aria-label={heading}>
    <div className="ow-bar ow-compact">
        <OrderMenu aria-label="Order market" text={filter.market ? marketName(filter.market) : 'Markets'}
          value={filter.market} onChange={event => onFilter({ market: event.target.value })}>
          <option value="">Markets</option>
          {markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </OrderMenu>
      <OrderMenu value={filter.status} text={filter.status || 'Status'} aria-label="Order status"
        onChange={event => onFilter({ status: event.target.value })}>
        <option value="">Status</option><option>Draft</option><option>Finalized</option><option>Sent</option>
      </OrderMenu>
      <input type="search" aria-label="Search orders" placeholder="Search" value={filter.query}
        onChange={event => onFilter({ query: event.target.value })} />
      {canEdit && <button className="ow-primary" type="button" disabled={!filter.market}
        onClick={() => onStart(filter.market, workflow)}>New {workflow === 'digital' ? 'digital' : 'broadcast'} order</button>}
    </div>
    <div className="ow-table-viewport"><table className="ow-table" aria-label={heading + ' table'}>
      <thead><tr><th scope="col">Order</th><th scope="col">Market</th><th scope="col">Vendor / rep</th>
        <th scope="col">Activity</th><th scope="col">Last updated</th></tr></thead>
      <tbody>
        {active.map(order => <tr key={order.id}>
          <th scope="row"><button type="button" className="ow-link" onClick={() => onOpen(order.id)}>
            {order.number || (order.workflow === 'digital' ? 'Digital draft' : 'Broadcast draft')}
          </button></th>
          <td>{order.marketIds.map(marketName).join(', ')}</td>
          <td>{order.vendor || '—'}</td>
          <td>{orderStatus(order)}{order.downloaded && <small>PDF downloaded</small>}</td>
          <td>{displayTime(order.updatedAt)}</td>
        </tr>)}
        {older.map(order => <tr key={'previous-' + order.campaignId + '-' + order.marketId}>
          <th scope="row"><a href={order.href}>{order.title}</a></th><td>{marketName(order.marketId)}</td>
          <td>—</td><td>Campaign order</td><td>—</td>
        </tr>)}
        {shown.map(item => <tr key={item.key}>
          <th scope="row"><button type="button" className="ow-link" disabled={!canEdit}
            onClick={() => onStart(item.marketId, item.workflow, item.key, item.archiveId ?? undefined)}>{item.title}</button></th>
          <td>{item.marketIds.map(marketName).join(', ')}</td><td>{[item.firm, item.rep].filter(Boolean).join(' · ') || '—'}</td>
          <td>{item.seedAvailable ? 'Signed history available' : 'New draft available'}
            {!!item.basis.length && <small>{item.basis.join(' · ')}</small>}</td>
          <td>—</td>
        </tr>)}
      </tbody>
    </table></div>
    {!active.length && !shown.length && !older.length && <p className="ow-empty">
      {canEdit ? 'Choose a market to start a new order.' : 'No orders match this view.'}
    </p>}
  </section>;
}

function selectedOrder(result: OrderDetail, marketProposed?: number | null): OpenOrder {
  return { editorKey:result.id, document: result.document, clientId: result.clientId, year: result.year, workflow: result.workflow,
    marketIds: result.marketIds, originKey: result.originKey ?? undefined, order: result, marketProposed };
}

export default function OrdersWorkspace({ initialOrderId, initialClientId, initialYear, initialMarketId, initialSection = 'broadcast',
  view = 'calendar', planUrl = '/campaign.html', campaignId, canEdit = true }: {
  initialOrderId?: string; initialClientId?: string; initialYear?: number; initialMarketId?: string; planUrl?: string; canEdit?: boolean;
  initialSection?: 'broadcast'|'digital'; view?: 'calendar' | 'orders' | 'historical'; campaignId?: string;
} = {}) {
  const [clientChoice, setClientChoice] = useState(initialClientId ?? '');
  const [yearChoice, setYearChoice] = useState(initialYear ?? 0);
  const [workflow, setWorkflow] = useState<OrderWorkflow>('broadcast');
  const [filter, setFilter] = useState<OrderFilter>(emptyFilter);
  const [editor, setEditor] = useState<OpenOrder | null>(null);
  const editorRef = useRef<OpenOrder | null>(null);
  editorRef.current = editor;
  const [fromPlan, setFromPlan] = useState(false);
  const [from, setFrom] = useState<Deadline | undefined>();
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [marketScope, setMarketScope] = useState<Workspace>();
  const openSequence = useRef(0);
  const openedInitial = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const directMarket = view === 'orders' && canEdit && Boolean(initialMarketId && initialClientId && initialYear && !initialOrderId);
  const waitingForOrderScope = initialOrderId && (!clientChoice || !yearChoice) && !error;
  const workspace = useOrdersQuery<Workspace>(directMarket || waitingForOrderScope ? '' : ordersUrl({
    view: 'workspace', clientId: clientChoice, year: yearChoice || undefined, scope: view === 'historical' ? 'history' : undefined,
  }));
  const data = directMarket ? marketScope : workspace.value;
  const client = data?.clients.find(item => item.id === (clientChoice || data.clientId)) ?? data?.clients[0];
  const year = yearChoice || data?.year || Number(businessDate().slice(0, 4)) + 1;
  const allMarkets = [...new Map((data?.markets ?? []).map(item => [item.id, item])).values()];
  const markets = allMarkets.filter(item => client?.marketIds.includes(item.id));
  const orders = data?.orders.filter(item => item.clientId === client?.id && item.year === year) ?? [];
  const editable = canEdit && (data?.canEdit ?? true);
  const operation = working || loadingOrder;
  const refresh = async () => { if (!directMarket) workspace.retry(); };

  async function post(action: OrderAction) {
    const key = JSON.stringify(action);
    const operationId = requestIds.current.get(key) ?? crypto.randomUUID();
    requestIds.current.set(key, operationId);
    const response = await fetch('/api/orders', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...action, operationId }),
    });
    if (response.status >= 400 && response.status < 500) requestIds.current.delete(key);
    return { response, done: () => requestIds.current.delete(key) };
  }

  const warnBeforeUnload = useCallback((event: BeforeUnloadEvent) => event.preventDefault(), []);
  useEffect(() => {
    if (!dirty) return;
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty, warnBeforeUnload]);

  const mutate: Mutate = async <Result,>(action: OrderAction): Promise<Result | undefined> => {
    setWorking(true); setError(''); setNotice('');
    try {
      const { response, done } = await post(action);
      const result = await ordersJson<Result>(response);
      done();
      return result;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Orders could not save your changes.');
    } finally {
      setWorking(false);
    }
  };

  function move(next: () => void) {
    if (dirty) { setError('Save or cancel your changes before leaving this order.'); return; }
    if (operation) return;
    setNotice(''); setError('');
    next();
  }

  const openOrder = useCallback(async (id: string, deadline?: Deadline, deepLink = false) => {
    const request = ++openSequence.current;
    setLoadingOrder(true); setError(''); setNotice(''); setFrom(deadline);
    returnTo.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    try {
      const result = await fetch(ordersUrl({ view: 'order', id }), { cache: 'no-store' }).then(ordersJson<OrderDetail>);
      if (request !== openSequence.current) return;
      if (deepLink) {
        setClientChoice(result.clientId);
        setYearChoice(result.year);
        setWorkflow(result.workflow);
      }
      setEditor(selectedOrder(result));
    } catch (problem) {
      if (request === openSequence.current) setError(problem instanceof Error ? problem.message : 'Could not open the order.');
    } finally {
      if (request === openSequence.current) setLoadingOrder(false);
    }
  }, []);

  useEffect(() => {
    if (!initialOrderId || openedInitial.current) return;
    openedInitial.current = true;
    void openOrder(initialOrderId, undefined, true);
  }, [initialOrderId, openOrder]);

  async function startOrder(marketId: string, workflow: OrderWorkflow, key?: string, archiveId?: string, deadline?: Deadline, fromCampaignPlan = false) {
    const bootstrap = directMarket && !marketScope && fromCampaignPlan;
    const clientId = bootstrap ? initialClientId : client?.id;
    if (!clientId || !editable) return;
    const request = ++openSequence.current;
    setLoadingOrder(true); setError(''); setNotice(''); setFrom(deadline);
    returnTo.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    try {
      const result = await fetch(ordersUrl({
        view: 'seed', key, archiveId, clientId, year: bootstrap ? initialYear : year, marketId, workflow, step: deadline?.step, campaignId,
        includeScope: bootstrap ? 1 : undefined,
      }), { cache: 'no-store' }).then(ordersJson<OpenOrder & { scope?: Workspace }>);
      if (request !== openSequence.current) return;
      if (bootstrap) {
        if (!result.scope) throw new Error('Could not load the market for this order.');
        setMarketScope(result.scope);
      }
      if (result.order && deadline && !deadline.orderIds.includes(result.order.id)) {
        const linked = await mutate<Deadline>({
          action: 'saveDeadline', id: deadline.id, calendarId: deadline.calendarId, expectedRevision: deadline.revision,
          marketId: deadline.marketId, step: deadline.step, dueDate: deadline.dueDate, orderIds: [...deadline.orderIds, result.order.id],
        });
        if (!linked || request !== openSequence.current) return;
        setFrom(linked);
        await refresh();
      }
      setFromPlan(fromCampaignPlan);
      setEditor(result.order ? selectedOrder(result.order,result.marketProposed) : {...result,editorKey:result.originKey??result.marketIds.join(':')});
    } catch (problem) {
      if (request === openSequence.current) setError(problem instanceof Error ? problem.message : 'Could not start the order.');
    } finally {
      if (request === openSequence.current) setLoadingOrder(false);
    }
  }

  useEffect(() => {
    if (initialOrderId || !initialMarketId || openedInitial.current || (!directMarket && (!client || !data))) return;
    openedInitial.current = true;
    void startOrder(initialMarketId, 'broadcast', undefined, undefined, undefined, true);
  }, [initialOrderId, initialMarketId, client, data, directMarket]);

  function update(result: OrderDetail) {
    setEditor(previous=>selectedOrder(result,previous?.marketProposed));
    setDirty(false);
    void refresh();
  }

  async function save(next: OpenOrder['document']) {
    const selected=editorRef.current;
    if (!selected) return;
    const existing = selected.order?.id;
    setWorking(true); setError('');
    try {
    const {response,done} = await post({
      action: 'saveOrder', ...(existing ? { id: existing } : {
        clientId: selected.clientId, year: selected.year, marketIds: selected.marketIds, workflow: selected.workflow,
        originKey: selected.originKey, archiveId: selected.archiveId, step: from?.step,
      }),
      expectedRevision: selected.order?.revision ?? 0,
      document: next,
      ...(from && !from.orderIds.includes(existing ?? '') ? { deadlineId: from.id, deadlineRevision: from.revision } : {}),
    });
    const result=await ordersJson<OrderDetail>(response);
    const expected=cleanOrderDocument(next,{marketIds:selected.marketIds,workflow:selected.workflow});
    if(canonicalJson(expected)!==canonicalJson(result.document))throw new Error('Another window changed this order after the save. Review the latest saved order before retrying.');
    done();
    if (result) {
      const updated={...selected,order:result};
      editorRef.current=updated;
      setEditor(previous=>previous ? {...previous,order:result} : previous); setFrom(item => item ? { ...item, orderIds: [...new Set([...item.orderIds, result.id])] } : undefined); setNotice('Draft saved.'); }
    return result;
    }catch(problem){setError(problem instanceof Error?problem.message:'Could not save this draft.');return undefined;}
    finally{setWorking(false);}
  }

  async function download(issueId: string) {
    if (!editor?.order) return;
    const id = editor.order.id;
    setWorking(true); setError(''); setNotice('');
    let url = '';
    try {
      const { response, done } = await post({ action: 'recordDownload', id, issueId });
      if (!response.ok) await ordersJson<never>(response);
      if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('The order PDF was unavailable.');
      const file = await response.blob();
      if (!file.size) throw new Error('The order PDF was empty.');
      done();
      url = URL.createObjectURL(file);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'Media-Order.pdf';
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice('Order PDF downloaded.');
      const result = await fetch(ordersUrl({ view: 'order', id }), { cache: 'no-store' }).then(ordersJson<OrderDetail>);
      setEditor(current => current?.order?.id === id ? { ...current, order: result } : current);
      await refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The order PDF could not be downloaded.');
    } finally {
      if (url) { const objectUrl = url; window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000); }
      setWorking(false);
    }
  }

  function dismissEditor() {
    setEditor(null);
    setFromPlan(false);
    setFrom(undefined);
    window.requestAnimationFrame(() => returnTo.current?.focus({ preventScroll: true }));
  }

  function closeEditor() {
    setDirty(false);
    if (fromPlan) window.location.assign(planUrl);
    else dismissEditor();
  }

  function cancelEditor() {
    if (operation) return;
    window.removeEventListener('beforeunload', warnBeforeUnload);
    setDirty(false);
    setError('');
    setNotice('');
    if (fromPlan) window.location.assign(planUrl);
    else dismissEditor();
  }

  const editorClient = data?.clients.find(item => item.id === editor?.clientId);
  const calendar = view === 'calendar';
  const calendarParams = new URLSearchParams({year:String(year),workflow});
  if(client)calendarParams.set('clientId',client.id);
  if(campaignId)calendarParams.set('campaignId',campaignId);
  const guardLeave = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (dirty || operation) { event.preventDefault(); move(() => {}); }
  };
  const scope = !editor && data && <>
    <OrderMenu aria-label="Client" text={client?.name || 'Client'} value={client?.id ?? ''} disabled={operation} onChange={event => {
      setError(''); setNotice(''); setClientChoice(event.target.value); setFilter(emptyFilter);
    }}>
      {!data.clients.length && <option value="">No clients available</option>}
      {data.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </OrderMenu>
    <form className="ow-year" onSubmit={event => {
      event.preventDefault();
      const next = Number(new FormData(event.currentTarget).get('year'));
      if (next !== year && Number.isInteger(next) && next >= 2000 && next <= 2100) {
        setYearChoice(next); setFilter(emptyFilter);
      }
    }}>
      <input key={year} type="number" name="year" aria-label="Planning year" title="Planning year"
        min={2000} max={2100} defaultValue={year} required disabled={operation}
        onBlur={event => {
          if (event.target.validity.valid) event.target.form?.requestSubmit();
          else event.target.value = String(year);
        }} />
    </form>
  </>;
  return <OrderFeedbackContext.Provider value={error}><div className="orders-workspace" role="region" aria-label="Orders">
    <header className="ow-heading campaign-calendar-heading"><h1>Campaign</h1></header>
    <nav className="campaign-view-nav" aria-label="Campaign views">
      <a href={planUrl} aria-current={!calendar ? 'page' : undefined} onClick={guardLeave}>Campaign plan</a>
      {calendar ? <button type="button" aria-label="Deadline Calendar" aria-current="page" onClick={closeEditor}>Calendar</button> :
        <a href={'/campaign/calendar?' + calendarParams} onClick={guardLeave}>Calendar</a>}
    </nav>
    {error && <div className="ow-feedback" role="alert">{error}</div>}
    {notice && <div className="ow-feedback ow-success" role="status">{notice}</div>}
    {workspace.error && <div className="ow-feedback" role="alert">{workspace.error} <button type="button" onClick={workspace.retry}>Retry</button></div>}
    {(workspace.busy || loadingOrder) && <p className="ow-empty" role="status">{loadingOrder ? 'Opening order…' : calendar ? 'Loading calendar…' : 'Loading orders…'}</p>}
    {scope && !calendar && !editor && <div className="ow-bar ow-compact ow-scope">{scope}</div>}
    {calendar && <OrderCalendar key={client?.id + ':' + year} hidden={!!editor || loadingOrder || !data}
      client={client} year={year} scope={scope} calendars={data?.calendars ?? []} orders={orders} markets={markets} busy={operation}
      legacy={data?.legacyOrders ?? []} opportunities={data?.opportunities ?? []}
      canEdit={editable} mutate={mutate} refresh={refresh} onOpen={openOrder}
      onCreate={(item, opportunity) => void startOrder(item.marketId, 'broadcast',
        opportunity?.key, opportunity?.archiveId ?? undefined, item)} />}
    {!editor && !loadingOrder && data && view === 'orders' &&
      <OrderList workflow="broadcast" orders={orders.filter(isMarketOrder)} opportunities={data.opportunities ?? []}
        legacy={data.legacyOrders ?? []} markets={markets} filter={filter} canEdit={editable}
        onFilter={patch => setFilter(old => ({ ...old, ...patch }))} onOpen={id => void openOrder(id)} onStart={startOrder} />}
    {!editor && data && view === 'historical' && (['broadcast','digital'] as const).map(kind =>
      orders.some(order=>order.workflow===kind) && <OrderList key={kind} workflow={kind} orders={orders} legacy={[]}
        title={kind==='broadcast'?'Legacy vendor orders':'Legacy Digital orders'} opportunities={[]} markets={markets}
        filter={filter} canEdit={false} onFilter={patch=>setFilter(old=>({...old,...patch}))}
        onOpen={id=>void openOrder(id)} onStart={startOrder} />)}
    {data && view === 'historical' && <HistoricalOrders key={client?.id + ':' + year} hidden={!!editor}
      client={client} markets={markets} currentYear={year} />}
    {editor && editorClient && <OrderEditor key={editor.editorKey} selection={editor} client={editorClient} markets={allMarkets} canEdit={editable && editor.workflow !== 'digital' && (view!=='historical' || isMarketOrder(editor))}
      busy={operation} fromCalendar={calendar} planUrl={fromPlan ? planUrl : undefined}
      sheet={from?.step ?? initialSection} mutate={mutate} onDirty={setDirty} onBack={closeEditor} onCancel={cancelEditor}
      onSave={save} onUpdate={update} onDownload={download} />}
  </div></OrderFeedbackContext.Provider>;
}
