import { createContext, useContext, useId, useRef, useEffect, useState, type ReactNode } from 'react';
import type { Calendar, Deadline, DeadlineStatus, DeadlineStep, LegacyOrderReference, OrderSummary } from '@/lib/orders/store';
import type { OrderOpportunity } from '@/lib/orders/sources';
import type { LegacyOrder } from './OrdersWorkspace';
import { OrderMenu } from './OrderToolbar';

export type ClientOption = { id: string; name: string; marketIds: string[] };
export type MarketOption = { id: string; name: string };
export type OrderAction = Record<string, unknown> & { action: string };
export type Mutate = <Result>(action: OrderAction) => Promise<Result | undefined>;
export const OrderFeedbackContext = createContext('');

export const steps: Record<DeadlineStep, string> = { tv: 'TV', radio: 'Radio', digital: 'Digital', copy: 'Ad Copy Sent to Reps' };
const statuses: DeadlineStatus[] = ['Not started', 'In progress', 'Complete', 'Not doing', 'Needs decision'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortStatus: Record<DeadlineStatus, string> = { 'Not started': 'To do', 'In progress': 'Active', Complete: 'Done', 'Not doing': 'Skip', 'Needs decision': 'Decide' };
const datePart = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const orderType = (order: OrderSummary) => order.workflow === 'digital' ? 'Digital' : 'Broadcast';

export function businessDate() {
  const parts = datePart.formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function displayDay(date: string, fields: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
}

export function displayTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(new Date(value));
}

function shiftDate(date: string, count: number, unit: 'month' | 'day') {
  const next = new Date(date + 'T00:00:00Z');
  if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + count, 1);
  else next.setUTCDate(next.getUTCDate() + count);
  return next.toISOString().slice(0, 10);
}

function calendarWeeks(date: string) {
  const first = date.slice(0, 7) + '-01';
  const previousDays = new Date(first + 'T00:00:00Z').getUTCDay();
  const last = Number(shiftDate(shiftDate(first, 1, 'month'), -1, 'day').slice(-2));
  return Array.from({ length: Math.ceil((previousDays + last) / 7) }, (_, week) =>
    weekdays.map((_, day) => shiftDate(first, week * 7 + day - previousDays, 'day')));
}

export function OrdersDialog({ title, onClose, children, drawer = false }: {
  title: string; onClose: () => void; children: ReactNode; drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const error = useContext(OrderFeedbackContext);
  useEffect(() => {
    const current = ref.current;
    current?.showModal();
    return () => { current?.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={heading} className={'ow-dialog' + (drawer ? ' ow-drawer' : '')}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={heading}>{title}</h2><button type="button" onClick={onClose}>Close</button></header>
    {error && <div className="ow-feedback" role="alert">{error}</div>}
    {children}
  </dialog>;
}

function CalendarNameForm({ calendar, client, year, busy, mutate, onSave }: {
  calendar?: Calendar; client: ClientOption; year: number; busy: boolean; mutate: Mutate; onSave: (calendar: Calendar) => void;
}) {
  return <form className="ow-form" onSubmit={async event => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    const saved = await mutate<Calendar>({
      action: 'saveCalendar', ...(calendar ? { id: calendar.id } : {}),
      clientId: client.id, year, name, expectedRevision: calendar?.revision ?? 0,
    });
    if (saved) onSave(saved);
  }}>
    <p>{client.name} · {year}</p>
    <label>Calendar name<input name="name" maxLength={100} required defaultValue={calendar?.name ?? ''} /></label>
    <button className="ow-primary" disabled={busy}>Save calendar</button>
  </form>;
}

function DeadlineForm({ calendar, markets, date, busy, mutate, onSave }: {
  calendar: Calendar; markets: MarketOption[]; date: string; busy: boolean; mutate: Mutate; onSave: (deadline: Deadline) => void;
}) {
  return <form className="ow-form" onSubmit={async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const saved = await mutate<Deadline>({
      action: 'saveDeadline', calendarId: calendar.id, expectedRevision: 0,
      marketId: String(values.get('market')), step: String(values.get('step')), dueDate: String(values.get('date')),
    });
    if (saved) onSave(saved);
  }}>
    <label>Market<select name="market" required defaultValue=""><option value="" disabled>Choose market</option>
      {markets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
    </select></label>
    <label>Step<select name="step">{Object.entries(steps).map(([value, label]) =>
      <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Due date<input name="date" type="date" required defaultValue={date} /></label>
    <button className="ow-primary" disabled={busy || !markets.length}>Add deadline</button>
  </form>;
}

function MarketDeadlinesForm({ calendar, markets, selectedMarketId, date, busy, mutate, onSave }: {
  calendar: Calendar; markets: MarketOption[]; selectedMarketId?: string; date: string;
  busy: boolean; mutate: Mutate; onSave: (dueDate: string) => void;
}) {
  return <form className="ow-form" onSubmit={async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const dueDate = String(values.get('date'));
    const saved = await mutate<Calendar>({
      action: 'saveMarketDeadlines', calendarId: calendar.id,
      marketId: selectedMarketId ?? String(values.get('market')), dueDate,
    });
    if (saved) onSave(dueDate);
  }}>
    {!selectedMarketId && <label>Market<select name="market" required defaultValue=""><option value="" disabled>Choose market</option>
      {markets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
    </select></label>}
    <label>Starting due date<input name="date" type="date" required defaultValue={date} autoFocus={!!selectedMarketId} /></label>
    <p>Add missing TV, Radio, Digital, and Ad Copy Sent to Reps steps. Each step can then be scheduled separately.</p>
    <button className="ow-primary" disabled={busy || (!selectedMarketId && !markets.length)}>Add market</button>
  </form>;
}

function UnscheduledMarketsDialog({ calendar, markets, date, busy, canEdit, mutate, onClose, onSave }: {
  calendar: Calendar; markets: MarketOption[]; date: string; busy: boolean; canEdit: boolean;
  mutate: Mutate; onClose: () => void; onSave: (dueDate: string) => void;
}) {
  const [selected, setSelected] = useState<MarketOption>();
  const [lastSelectedId, setLastSelectedId] = useState('');
  return <OrdersDialog title={selected ? 'Schedule ' + selected.name : 'Unscheduled markets'} onClose={onClose}>
    {selected ? <>
      <button type="button" className="ow-link" disabled={busy} onClick={() => setSelected(undefined)}>Back to markets</button>
      <MarketDeadlinesForm calendar={calendar} markets={markets} selectedMarketId={selected.id}
        date={date} busy={busy} mutate={mutate} onSave={onSave} />
    </> : markets.length ? <ul className="ow-link-orders">
      {markets.map(market => <li key={market.id}>
        {canEdit ? <button type="button" className="ow-link" autoFocus={lastSelectedId === market.id} onClick={() => {
          setLastSelectedId(market.id);
          setSelected(market);
        }}>{market.name}</button> : market.name}
      </li>)}
    </ul> : <p>All client markets are on this calendar.</p>}
  </OrdersDialog>;
}

const legacyKey = (item: LegacyOrderReference) => item.campaignId + ':' + item.marketId;
function DeadlineOrders({ deadline, choices, legacy, opportunities, market, busy, canEdit, onSave, onOpen, onCreate }: {
  deadline: Deadline; choices: OrderSummary[]; market: string; busy: boolean; canEdit: boolean;
  legacy: LegacyOrder[]; opportunities: OrderOpportunity[];
  onSave: (ids: string[], legacyRefs: LegacyOrderReference[]) => Promise<void>;
  onOpen: (id: string, from: Deadline) => void; onCreate: (from: Deadline, item?: OrderOpportunity) => void;
}) {
  const [selected, setSelected] = useState(new Set(deadline.orderIds));
  const [selectedLegacy, setSelectedLegacy] = useState(new Set(deadline.legacyRefs?.map(legacyKey)));
  return <div className="ow-form">
    {(!!choices.length || !!legacy.length) && <ul className="ow-link-orders">{choices.map(order => <li key={order.id}>
      {canEdit && <input type="checkbox" checked={selected.has(order.id)}
        aria-label={'Link ' + (order.number || orderType(order) + ' draft') + ' ' + market}
        disabled={busy} onChange={event => setSelected(previous => {
          const next = new Set(previous);
          if (event.target.checked) next.add(order.id);
          else next.delete(order.id);
          return next;
        })} />}
      <button type="button" className="ow-link" onClick={() => onOpen(order.id, deadline)}>
        {order.number || orderType(order) + ' draft'}
      </button>
      <span>{order.sent ? 'Sent' : order.currentIssue ? 'Finalized' : 'Draft'}</span>
    </li>)}
      {legacy.map(order => <li key={legacyKey(order)}>
        {canEdit && <input type="checkbox" checked={selectedLegacy.has(legacyKey(order))}
          aria-label={'Link ' + order.title} disabled={busy} onChange={event => setSelectedLegacy(previous => {
            const next = new Set(previous);
            if (event.target.checked) next.add(legacyKey(order));
            else next.delete(legacyKey(order));
            return next;
          })} />}
        <a href={order.href}>{order.title}</a>
        <span>Campaign order</span>
      </li>)}
    </ul>}
    {(!!choices.length || !!legacy.length) && canEdit && <button type="button" className="ow-primary" disabled={busy}
      onClick={() => void onSave([...selected], legacy.filter(item => selectedLegacy.has(legacyKey(item)))
        .map(item => ({ campaignId: item.campaignId, marketId: item.marketId, title: item.title })))}>Save links</button>}
    {canEdit && deadline.step !== 'copy' && <>
      {!!opportunities.length && <ul className="ow-link-orders">{opportunities.map(item => <li key={item.key}>
        <button type="button" className="ow-link" onClick={() => onCreate(deadline, item)}>{item.title}</button>
        <span>{item.seedAvailable ? 'Signed history available' : 'New draft available'}</span>
      </li>)}</ul>}
      <button type="button" onClick={() => onCreate(deadline)}>Open a new draft</button>
    </>}
    {!choices.length && !legacy.length && !canEdit && <p>No orders linked to this deadline.</p>}
  </div>;
}

export function OrderCalendar({ hidden, client, year, scope, calendars, orders, legacy, opportunities, markets, busy, canEdit, mutate, refresh, onOpen, onCreate }: {
  hidden: boolean; client: ClientOption | undefined; year: number; scope: ReactNode; calendars: Calendar[];
  orders: OrderSummary[]; legacy: LegacyOrder[]; opportunities: OrderOpportunity[]; markets: MarketOption[]; busy: boolean; canEdit: boolean;
  mutate: Mutate; refresh: () => Promise<void>;
  onOpen: (id: string, from: Deadline) => void; onCreate: (from: Deadline, item?: OrderOpportunity) => void;
}) {
  const [calendarId, setCalendarId] = useState('');
  const scoped = calendars.filter(item => item.clientId === client?.id && item.year === year);
  const calendar = scoped.find(item => item.id === calendarId) ?? scoped[0];
  const [date, setDate] = useState('');
  const [mode, setMode] = useState<'month' | 'day'>('month');
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('');
  const [step, setStep] = useState('');
  const [status, setStatus] = useState('');
  const [panel, setPanel] = useState<'calendar' | 'rename' | 'deadline' | 'market' | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [orderSelection, setOrderSelection] = useState<string | null>(null);
  const [copySelection, setCopySelection] = useState<string | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const [pickerFallback, setPickerFallback] = useState(false);
  const returnTo = useRef<HTMLElement>(null);
  const [pickedQueryDate, setPickedQueryDate] = useState('');
  const marketName = (id: string) => markets.find(item => item.id === id)?.name ?? id;
  const selectedDeadline = calendar?.deadlines.find(item => item.id === orderSelection);
  const copyDeadline = calendar?.deadlines.find(item => item.id === copySelection);
  const scheduledMarketIds = new Set(calendar?.deadlines.map(item => item.marketId));
  const unscheduledMarkets = markets.filter(item => !scheduledMarketIds.has(item.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const today = businessDate();
  const scheduledDates = calendar?.deadlines.map(item => item.dueDate).sort() ?? [];
  const currentDate = date || (scheduledDates.some(day => day.slice(0, 7) === today.slice(0, 7)) ? today :
    scheduledDates.find(day => day >= today) ?? scheduledDates.at(-1) ?? today);
  const search = query.trim().toLowerCase();
  const matchesPeriod = (dueDate: string, selected: string) => (mode === 'day' ? dueDate === selected : dueDate.slice(0, 7) === selected.slice(0, 7));
  const deadlines = (calendar?.deadlines ?? []).filter(item => {
    if (market && item.marketId !== market || step && item.step !== step ||
        status && (status === 'Overdue' || status === 'Due today' ? urgency(item) !== status : item.status !== status)) return false;
    const numbers = orders.filter(order => item.orderIds.includes(order.id)).map(order => order.number);
    const older = item.legacyRefs?.map(order => order.title) ?? [];
    return !search || [marketName(item.marketId), steps[item.step], item.dueDate, item.status, ...numbers, ...older].join(' ').toLowerCase().includes(search);
  }).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || marketName(left.marketId).localeCompare(marketName(right.marketId))
    || Object.keys(steps).indexOf(left.step) - Object.keys(steps).indexOf(right.step));
  const visibleDate = search && (pickedQueryDate || (!deadlines.some(item => matchesPeriod(item.dueDate, currentDate)) && deadlines[0]?.dueDate))
    || currentDate;
  const relevantDates = [...new Set(deadlines.map(item => mode === 'day' ? item.dueDate : item.dueDate.slice(0, 7) + '-01'))];
  const byDate = new Map<string, Deadline[]>();
  for (const item of deadlines) byDate.set(item.dueDate, [...(byDate.get(item.dueDate) ?? []), item]);
  const dayItems = byDate.get(visibleDate) ?? [];
  const eligibleOrders = (item: Deadline) => orders.filter(order =>
    order.clientId === calendar?.clientId && order.year === calendar.year
    && order.marketIds.includes(item.marketId)
    && (item.step === 'copy' || (item.step === 'digital' ? order.workflow === 'digital'
      : order.workflow === 'broadcast' && (item.orderIds.includes(order.id) || order.media.some(medium => medium.toLowerCase() === item.step)))));
  const eligibleLegacy = (item: Deadline) => legacy.filter(order => order.clientId === calendar?.clientId && order.year === calendar.year
    && order.marketId === item.marketId && (item.step === 'copy' || item.step !== 'digital'
      && (Array.isArray(order.media) ? order.media : [order.media]).some(medium => medium.toLowerCase() === item.step)));
  const eligibleOpportunities = (item: Deadline) => opportunities.filter(order => order.clientId === calendar?.clientId && order.year === calendar.year
    && order.marketIds.includes(item.marketId) && (item.step === 'digital' ? order.workflow === 'digital'
      : item.step !== 'copy' && order.workflow === 'broadcast' && order.media.some(medium => medium.toLowerCase() === item.step))
    && !orders.some(saved => saved.originKey === order.key));

  useEffect(() => {
    if (!hidden) returnTo.current?.focus({ preventScroll: true });
  }, [hidden]);

  function chooseDate(next: string) {
    if (!next) return;
    setDate(next);
    if (search) setPickedQueryDate(next);
  }

  function clearFilters() {
    setMarket(''); setStep(''); setStatus(''); setQuery(''); setPickedQueryDate('');
  }

  function chooseCalendar(next: Calendar) {
    setCalendarId(next.id);
    const first = next.deadlines.map(item => item.dueDate).sort().find(day => day >= today)
      ?? next.deadlines.map(item => item.dueDate).sort()[0];
    setDate(first ?? today);
    clearFilters();
  }

  async function changeDeadline(item: Deadline, patch: Record<string, unknown>) {
    const next = await mutate<Deadline>({
      action: 'saveDeadline', id: item.id, calendarId: item.calendarId, expectedRevision: item.revision,
      marketId: item.marketId, step: item.step, dueDate: item.dueDate, ...patch,
    });
    if (next) await refresh();
    return next;
  }

  async function openLinked(id: string, item: Deadline) {
    if (!canEdit || item.orderIds.includes(id)) { onOpen(id, item); return; }
    const linked = await changeDeadline(item, { orderIds: [...item.orderIds, id] });
    if (linked) onOpen(id, linked);
  }

  function follow(item: Deadline, trigger: HTMLElement) {
    returnTo.current = trigger;
    if (item.step === 'copy') { setCopySelection(item.id); return; }
    if (canEdit && (item.step === 'tv' || item.step === 'radio')) {
      onCreate(item);
      return;
    }
    const available = eligibleOrders(item);
    const linked = available.filter(order => item.orderIds.includes(order.id));
    const older = eligibleLegacy(item);
    const matching = eligibleOpportunities(item);
    if (linked.length === 1 && !item.legacyRefs?.length) { onOpen(linked[0].id, item); return; }
    const singleMarket = available.filter(order => order.marketIds.length === 1);
    if (item.legacyRefs?.length || linked.length > 1 || singleMarket.length > 1 || older.length) { setOrderSelection(item.id); return; }
    if (singleMarket.length) { void openLinked(singleMarket[0].id, item); return; }
    if (canEdit) onCreate(item, matching.find(option => option.marketIds.length === 1));
    else setOrderSelection(item.id);
  }

  function statusControl(item: Deadline, compact = false) {
    const text = compact ? item.status === 'Not started' && !item.statusOverride ? '—' : shortStatus[item.status] : item.status;
    return canEdit ? <span className="ow-status ow-status-link" title={[item.status, urgency(item)].filter(Boolean).join(' · ')}>
      <span aria-hidden="true">{text}</span>
      <select key={item.revision}
      aria-label={marketName(item.marketId) + ' ' + steps[item.step] + ' status'}
      title={item.status} disabled={busy}
      value={item.statusOverride ?? ''}
      onChange={event => void changeDeadline(item, { statusOverride: event.target.value || null })}>
      <option value="">{item.statusOverride ? 'Automatic' : 'Automatic · ' + item.status}</option>
      {statuses.map(option => <option key={option} value={option}>{option}</option>)}
    </select></span> : <span className="ow-status" title={item.status}>{text}</span>;
  }

  function orderLink(item: Deadline, compact = false) {
    return <button className="ow-link ow-step" type="button" disabled={busy}
      aria-label={steps[item.step]} title={steps[item.step]}
      onClick={event => follow(item, event.currentTarget)}>
      {compact && item.step === 'copy' ? 'Ad copy' : steps[item.step]}
    </button>;
  }

  function urgency(item: Deadline) {
    return item.status !== 'Complete' && item.status !== 'Not doing'
      ? item.dueDate < today ? 'Overdue' : item.dueDate === today ? 'Due today' : '' : '';
  }

  function monthDeadlines(day: string) {
    const groups = new Map<string, Deadline[]>();
    for (const item of byDate.get(day) ?? []) {
      const group = groups.get(item.marketId);
      if (group) group.push(item);
      else groups.set(item.marketId, [item]);
    }
    return [...groups].map(([marketId, items]) => <div className="ow-day-market" key={marketId}>
      <strong>{marketName(marketId)}</strong>
      {items.map(item => <div className="ow-day-item" key={item.id} data-urgency={urgency(item)}>
        {orderLink(item, true)}{statusControl(item, true)}
      </div>)}
    </div>);
  }

  const manage = canEdit && client && <details className="ow-menu" onClick={event => {
        if (event.target instanceof HTMLElement && event.target.closest('button')) event.currentTarget.open = false;
      }}>
        <summary>Manage</summary>
        <div className="ow-menu-items">
        <button type="button" onClick={() => setPanel('calendar')}>New calendar</button>
        {calendar && <>
          <button type="button" onClick={() => setPanel('rename')}>Rename calendar</button>
          <button type="button" onClick={() => setPanel('market')}>Add market</button>
          <button type="button" onClick={() => setPanel('deadline')}>Add deadline</button>
        </>}
        </div>
      </details>;
  return <>
    <section hidden={hidden} aria-label="Deadline calendar" className="ow-calendar">
    <div className="ow-calendar-toolbar">
    {calendar && <div className="ow-bar ow-compact ow-period">
      <div className="ow-period-range">
        <button type="button" aria-label={'Previous ' + mode} onClick={() => chooseDate(shiftDate(visibleDate, -1, mode))}>‹</button>
        <button type="button" className="ow-period-label" title="Choose a date" onClick={() => {
          const input = dateInput.current;
          if (!input) return;
          try { if (!input.showPicker) throw new Error(); input.showPicker(); }
          catch { setPickerFallback(true); requestAnimationFrame(() => input.focus()); }
        }}>{displayDay(visibleDate, mode === 'month' ? { month: 'long', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</button>
        <input className={pickerFallback ? '' : 'ow-calendar-picker'} ref={dateInput} type="date" aria-label="Go to date"
          tabIndex={pickerFallback ? 0 : -1} value={visibleDate} onChange={event => { chooseDate(event.target.value); setPickerFallback(false); }}
          onKeyDown={event => { if (event.key === 'Escape') setPickerFallback(false); }} />
        <button type="button" aria-label={'Next ' + mode} onClick={() => chooseDate(shiftDate(visibleDate, 1, mode))}>›</button>
      </div>
        <div className="ow-calendar-view" role="group" aria-label="Calendar view">
          <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month</button>
          <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Day</button>
        </div>
        <button type="button" onClick={() => chooseDate(today)}>Today</button>
        {manage}
        <button type="button" className="ow-link" aria-haspopup="dialog" onClick={() => setUnscheduledOpen(true)}>
          Unscheduled markets ({unscheduledMarkets.length})
        </button>
    </div>}
    <div className="ow-bar ow-compact ow-calendar-context">
      <div className="ow-calendar-selection" role="group" aria-label="Calendar selection">
        {scope}
        <OrderMenu aria-label="Calendar" text={calendar?.name || 'No calendar'} value={calendar?.id ?? ''} disabled={!scoped.length}
          onChange={event => {
            const next = scoped.find(item => item.id === event.target.value);
            if (next) chooseCalendar(next);
          }}>
          {!scoped.length && <option value="">No calendar</option>}
          {scoped.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </OrderMenu>
        {!calendar && manage}
      </div>
      {calendar && <div className="ow-calendar-filters" role="group" aria-label="Deadline filters">
        <OrderMenu aria-label="Calendar market" text={market ? marketName(market) : 'Markets'} value={market} onChange={event => setMarket(event.target.value)}>
          <option value="">Markets</option>{markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </OrderMenu>
        <OrderMenu aria-label="Calendar step" text={step ? steps[step as DeadlineStep] : 'Steps'} value={step} onChange={event => setStep(event.target.value)}>
          <option value="">Steps</option>{Object.entries(steps).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </OrderMenu>
        <OrderMenu aria-label="Calendar status" text={status || 'Status'} value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Status</option>{[...statuses, 'Overdue', 'Due today'].map(item => <option key={item}>{item}</option>)}
        </OrderMenu>
        <span className="ow-search">
          <input type="search" aria-label="Search deadlines" placeholder="Search" value={query}
            onChange={event => { setQuery(event.target.value); setPickedQueryDate(''); }} />
        </span>
        {(query || market || step || status) && <button className="ow-link" type="button" onClick={clearFilters}>Clear</button>}
        {search && relevantDates.length > 1 && <OrderMenu aria-label="Matches" text="Matches"
          value={mode === 'day' ? visibleDate : visibleDate.slice(0, 7) + '-01'} onChange={event => chooseDate(event.target.value)}>
            {!relevantDates.includes(mode === 'day' ? visibleDate : visibleDate.slice(0, 7) + '-01') && <option value="">Choose date</option>}
            {relevantDates.map(day => <option key={day} value={day}>
              {displayDay(day, mode === 'day' ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', year: 'numeric' })}
            </option>)}
        </OrderMenu>}
      </div>}
    </div>
    </div>
    {calendar ? <>
      {mode === 'month' ? <table className="ow-month" aria-label={displayDay(visibleDate, { month: 'long', year: 'numeric' }) + ' deadlines'}>
        <thead><tr>{weekdays.map(day => <th key={day} scope="col" title={day}>{day.slice(0, 3)}</th>)}</tr></thead>
        <tbody>{calendarWeeks(visibleDate).map(week => <tr key={week[0]}>{week.map(day => <td key={day}
          data-outside={day.slice(0, 7) !== visibleDate.slice(0, 7)}
          onClick={event => {
            if (!(event.target as Element).closest('button, select, .ow-status-link')) { chooseDate(day); setMode('day'); }
          }}>
          <button className="ow-day-number" type="button" aria-current={day === today ? 'date' : undefined}
            aria-label={'View ' + displayDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            onClick={() => { chooseDate(day); setMode('day'); }}>{Number(day.slice(-2))}</button>
          {monthDeadlines(day)}
        </td>)}</tr>)}</tbody>
      </table> : <div className="ow-table-viewport"><table className="ow-table" aria-label="Daily deadlines">
        <thead><tr><th scope="col">Market</th><th scope="col">Step</th><th scope="col">Due date</th><th scope="col">Status</th>
          <th scope="col">Order activity</th><th scope="col">Links</th></tr></thead>
        <tbody>{dayItems.map(item => {
          const linked = orders.filter(order => item.orderIds.includes(order.id));
          const activity = item.step === 'copy' ? (item.copySentAt ? 'Sent ' + displayTime(item.copySentAt) : '')
            : linked.map(order => [order.number, order.sent ? 'Sent' : order.downloaded ? 'PDF downloaded' : order.currentIssue ? 'Finalized' : 'Draft'].filter(Boolean).join(' · ')).join(', ');
          return <tr key={item.id}>
            <th scope="row">{marketName(item.marketId)}</th><td>{orderLink(item)}</td>
            <td>{canEdit ? <input type="date" key={item.revision} aria-label={'Due date for ' + marketName(item.marketId) + ' ' + steps[item.step]}
              defaultValue={item.dueDate} disabled={busy} onBlur={event => {
                if (event.target.value && event.target.validity.valid && event.target.value !== item.dueDate)
                  void changeDeadline(item, { dueDate: event.target.value });
              }} /> : item.dueDate}</td>
            <td>{statusControl(item)}{urgency(item) && <small>{urgency(item)}</small>}</td>
            <td>{activity || (item.legacyRefs?.length ? item.legacyRefs.map(link => link.title ?? 'Campaign order').join(', ') : '—')}</td>
            <td><button type="button" className="ow-link" onClick={() => setOrderSelection(item.id)}>Orders</button></td>
          </tr>;
        })}</tbody>
      </table>{!dayItems.length && <p className="ow-empty">No deadlines on this date.</p>}</div>}
      {search && !deadlines.length && <p className="ow-empty">No deadlines match this search.</p>}
    </> : <p className="ow-empty">{client ? 'No calendars for ' + client.name + ' in ' + year + '.' : 'Choose a client to see deadlines.'}</p>}
    {unscheduledOpen && calendar && <UnscheduledMarketsDialog calendar={calendar} markets={unscheduledMarkets}
      date={visibleDate} busy={busy} canEdit={canEdit} mutate={mutate} onClose={() => setUnscheduledOpen(false)}
      onSave={dueDate => {
        setUnscheduledOpen(false);
        clearFilters();
        setDate(dueDate);
        void refresh();
      }} />}
    {panel && client && <OrdersDialog title={panel === 'deadline' ? 'Add deadline' : panel === 'rename' ? 'Rename calendar'
      : panel === 'market' ? 'Add market' : 'New calendar'}
      onClose={() => setPanel(null)}>
      {panel === 'deadline' && calendar ? <DeadlineForm calendar={calendar} markets={markets} date={visibleDate} busy={busy}
        mutate={mutate} onSave={saved => { setPanel(null); chooseDate(saved.dueDate); void refresh(); }} />
      : panel === 'market' && calendar ? <MarketDeadlinesForm calendar={calendar} markets={markets} date={visibleDate} busy={busy}
        mutate={mutate} onSave={dueDate => { setPanel(null); chooseDate(dueDate); void refresh(); }} />
      : <CalendarNameForm calendar={panel === 'rename' ? calendar : undefined} client={client} year={year} busy={busy}
        mutate={mutate} onSave={saved => { setPanel(null); chooseCalendar(saved); void refresh(); }} />}
    </OrdersDialog>}
    {copyDeadline && <OrdersDialog title={marketName(copyDeadline.marketId) + ' · Ad Copy Sent to Reps'} onClose={() => setCopySelection(null)}>
      {copyDeadline.copySentAt && <p>Sent {displayTime(copyDeadline.copySentAt)}</p>}
      {canEdit && <form className="ow-form" onSubmit={async event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const sentAt = new Date(String(values.get('sentAt'))).toISOString();
        const next = await mutate<Deadline>({ action: 'recordCopySend', id: copyDeadline.id,
          expectedRevision: copyDeadline.revision, sentAt, note: String(values.get('note') ?? '') });
        if (next) { setCopySelection(null); await refresh(); }
      }}>
        <label>Sent at<input type="datetime-local" name="sentAt" required /></label>
        <label>Note<input name="note" maxLength={500} /></label>
        <button className="ow-primary" disabled={busy}>Record ad copy sent</button>
      </form>}
    </OrdersDialog>}
    </section>
    {selectedDeadline && <OrdersDialog title={marketName(selectedDeadline.marketId) + ' · ' + steps[selectedDeadline.step] + ' orders'} onClose={() => setOrderSelection(null)}>
      <DeadlineOrders deadline={selectedDeadline} choices={eligibleOrders(selectedDeadline)} legacy={eligibleLegacy(selectedDeadline)}
        opportunities={eligibleOpportunities(selectedDeadline)} market={marketName(selectedDeadline.marketId)} busy={busy} canEdit={canEdit}
        onSave={async (ids, legacyRefs) => { if (await changeDeadline(selectedDeadline, { orderIds: ids, legacyRefs })) setOrderSelection(null); }}
        onOpen={(id, deadline) => { setOrderSelection(null); void openLinked(id, deadline); }}
        onCreate={(deadline, item) => { setOrderSelection(null); onCreate(deadline, item); }} />
    </OrdersDialog>}
  </>;
}
