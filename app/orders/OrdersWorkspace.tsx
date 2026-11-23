'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deadline, OrderDetail, OrderSummary, OrderWorkflow, OrderWorkspace } from '@/lib/orders/store';
import { businessDate, OrderCalendar, displayTime, OrderFeedbackContext, type ClientOption, type MarketOption, type Mutate, type OrderAction } from './OrderCalendar';
import { HistoricalOrders, ordersJson, ordersUrl, useOrdersGet, type OrderOpportunity } from './OrdersCatalog';
import { OrderEditor, type OpenOrder } from './OrderEditor';
import { OrderMenu } from './OrderToolbar';

export type LegacyOrder = {
  campaignId: string; marketId: string; title: string; year: number; clientId: string; media: string | string[]; href: string;
};
type Workspace = OrderWorkspace & {
  clients: ClientOption[]; markets: MarketOption[]; opportunities: OrderOpportunity[];
  legacyOrders?: LegacyOrder[]; canEdit?: boolean; clientId?: string; year?: number;
};
type Area = 'calendar' | 'planning' | 'digital' | 'historical';
const areas: Record<Area, string> = { calendar: 'Deadline Calendar', planning: 'Order planning', digital: 'Digital orders', historical: 'Historical orders' };
type OrderFilter = { market: string; query: string; status: string };
const emptyFilter: OrderFilter = { market: '', query: '', status: '' };

function orderStatus(order: OrderSummary) {
  return order.sent ? 'Sent' : order.currentIssue ? 'Finalized' : 'Draft';
}

function OrderList({ workflow, orders, opportunities, legacy, markets, filter, canEdit, onFilter, onOpen, onStart }: {
  workflow: OrderWorkflow; orders: OrderSummary[]; opportunities: OrderOpportunity[]; legacy: LegacyOrder[]; markets: MarketOption[];
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
  const heading = workflow === 'digital' ? 'Digital orders' : 'Order planning';

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

function selectedOrder(result: OrderDetail): OpenOrder {
  return { document: result.document, clientId: result.clientId, year: result.year, workflow: result.workflow,
    marketIds: result.marketIds, order: result };
}

export default function OrdersWorkspace({ initialOrderId, initialClientId, canEdit = true }: {
  initialOrderId?: string; initialClientId?: string; canEdit?: boolean;
} = {}) {
  const [clientChoice, setClientChoice] = useState(initialClientId ?? '');
  const [yearChoice, setYearChoice] = useState(0);
  const [area, setArea] = useState<Area>('calendar');
  const [filter, setFilter] = useState<OrderFilter>(emptyFilter);
  const [editor, setEditor] = useState<OpenOrder | null>(null);
  const [from, setFrom] = useState<Deadline | undefined>();
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [archiveYear, setArchiveYear] = useState<number | undefined>();
  const openSequence = useRef(0);
  const openedInitial = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const workspace = useOrdersGet<Workspace>(ordersUrl({ view: 'workspace', clientId: clientChoice, year: yearChoice || undefined }));
  const data = workspace.value;
  const client = data?.clients.find(item => item.id === (clientChoice || data.clientId)) ?? data?.clients[0];
  const year = yearChoice || data?.year || Number(businessDate().slice(0, 4)) + 1;
  const allMarkets = [...new Map((data?.markets ?? []).map(item => [item.id, item])).values()];
  const markets = allMarkets.filter(item => client?.marketIds.includes(item.id));
  const orders = data?.orders.filter(item => item.clientId === client?.id && item.year === year) ?? [];
  const editable = canEdit && (data?.canEdit ?? true);
  const operation = working || loadingOrder;
  const refresh = async () => { workspace.retry(); };

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

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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

  async function startOrder(marketId: string, workflow: OrderWorkflow, key?: string, archiveId?: string, deadline?: Deadline) {
    if (!client || !editable) return;
    const request = ++openSequence.current;
    setLoadingOrder(true); setError(''); setNotice(''); setFrom(deadline);
    returnTo.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    try {
      const result = await fetch(ordersUrl({ view: 'seed', key, archiveId, clientId: client.id, year, marketId, workflow, step: deadline?.step }),
        { cache: 'no-store' }).then(ordersJson<OpenOrder>);
      if (request !== openSequence.current) return;
      if (result.order && deadline && !deadline.orderIds.includes(result.order.id)) {
        const linked = await mutate<Deadline>({
          action: 'saveDeadline', id: deadline.id, calendarId: deadline.calendarId, expectedRevision: deadline.revision,
          marketId: deadline.marketId, step: deadline.step, dueDate: deadline.dueDate, orderIds: [...deadline.orderIds, result.order.id],
        });
        if (!linked || request !== openSequence.current) return;
        setFrom(linked);
        await refresh();
      }
      setEditor(result.order ? selectedOrder(result.order) : result);
    } catch (problem) {
      if (request === openSequence.current) setError(problem instanceof Error ? problem.message : 'Could not start the order.');
    } finally {
      if (request === openSequence.current) setLoadingOrder(false);
    }
  }

  function update(result: OrderDetail) {
    setEditor(selectedOrder(result));
    setDirty(false);
    void refresh();
  }

  async function save(next: OpenOrder['document']) {
    if (!editor) return;
    const existing = editor.order?.id;
    const result = await mutate<OrderDetail>({
      action: 'saveOrder', ...(existing ? { id: existing } : {
        clientId: editor.clientId, year: editor.year, marketIds: editor.marketIds, workflow: editor.workflow,
        originKey: editor.originKey, archiveId: editor.archiveId, step: from?.step,
      }),
      expectedRevision: editor.order?.revision ?? 0,
      document: next,
      ...(from && !from.orderIds.includes(existing ?? '') ? { deadlineId: from.id, deadlineRevision: from.revision } : {}),
    });
    if (result) { update(result); setFrom(item => item ? { ...item, orderIds: [...new Set([...item.orderIds, result.id])] } : undefined); setNotice('Draft saved.'); }
    return result;
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

  function closeEditor() {
    move(() => {
      setEditor(null);
      setFrom(undefined);
      window.requestAnimationFrame(() => returnTo.current?.focus({ preventScroll: true }));
    });
  }

  const editorClient = data?.clients.find(item => item.id === editor?.clientId);
  const currentArea = editor ? (editor.workflow === 'digital' ? 'digital' : 'planning') : area;
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
        setYearChoice(next); setFilter(emptyFilter); setArchiveYear(next - 1);
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
    <header className="ow-heading"><h1>Orders</h1>
      <details className="ow-menu ow-legacy-menu">
        <summary>Legacy orders</summary>
        <div className="ow-menu-items"><a href="/orders.html">Campaign Orders</a><a href="/legacy-orders.html">Workbook Orders</a></div>
      </details>
    </header>
    <nav className="ow-tabs" aria-label="Orders sections">
      {(Object.entries(areas) as [Area, string][]).map(([key, title]) => <button type="button" key={key}
        aria-current={currentArea === key ? 'page' : undefined} onClick={() => move(() => {
          setEditor(null); setFrom(undefined); setArea(key);
          if (key === 'historical') setArchiveYear(year - 1);
        })}>{title}</button>)}
    </nav>
    {error && <div className="ow-feedback" role="alert">{error}</div>}
    {notice && <div className="ow-feedback ow-success" role="status">{notice}</div>}
    {workspace.error && <div className="ow-feedback" role="alert">{workspace.error} <button type="button" onClick={workspace.retry}>Retry</button></div>}
    {(workspace.busy || loadingOrder) && <p className="ow-empty" role="status">{loadingOrder ? 'Opening order…' : 'Loading Orders…'}</p>}
    {scope && area !== 'calendar' && <div className="ow-bar ow-compact ow-scope">{scope}</div>}
    <OrderCalendar key={client?.id + ':' + year} hidden={!!editor || area !== 'calendar' || !data}
      client={client} year={year} scope={scope} calendars={data?.calendars ?? []} orders={orders} markets={markets} busy={operation}
      legacy={data?.legacyOrders ?? []} opportunities={data?.opportunities ?? []}
      canEdit={editable} mutate={mutate} refresh={refresh} onOpen={openOrder}
      onCreate={(item, opportunity) => void startOrder(item.marketId, item.step === 'digital' ? 'digital' : 'broadcast',
        opportunity?.key, opportunity?.archiveId ?? undefined, item)} />
    {!editor && data && (area === 'planning' || area === 'digital') &&
      <OrderList workflow={area === 'digital' ? 'digital' : 'broadcast'} orders={orders} opportunities={data.opportunities ?? []}
        legacy={data.legacyOrders ?? []} markets={markets} filter={filter} canEdit={editable}
        onFilter={patch => setFilter(old => ({ ...old, ...patch }))} onOpen={id => void openOrder(id)} onStart={startOrder} />}
    {data && <HistoricalOrders key={client?.id + ':' + (archiveYear ?? year - 1)} hidden={!!editor || area !== 'historical'}
      client={client} markets={markets} currentYear={year} canEdit={editable}
      onSeed={(record, marketId) => void startOrder(marketId, record.workflow, undefined, record.id)} />}
    {editor && editorClient && <OrderEditor selection={editor} client={editorClient} markets={allMarkets} canEdit={editable}
      busy={operation} fromCalendar={!!from} sheet={from?.step ?? ''} mutate={mutate} onDirty={setDirty} onBack={closeEditor}
      onSave={save} onUpdate={update} onDownload={download} />}
  </div></OrderFeedbackContext.Provider>;
}
