import type { ResearchState,ResearchView } from '@/lib/order-assistant/types';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import FilePreviewDrawer from '@/app/research/_components/FilePreviewDrawer';
import FilterRibbon, { emptyFilters, type Filters } from '@/app/research/broadcast/FilterRibbon';
import GroupControl, { noGrouping, type Grouping } from '@/app/research/broadcast/GroupControl';
import type { BroadcastHistoryMedia, DigitalDraftValues, MarketBroadcastHistory } from '@/lib/orders/sources';
import type { OrderDocument, OrderLine, OrderWorkflow } from '@/lib/orders/store';
import { isResearchSelected, selectedResearchKeys } from '@/lib/orders/research-selection';
import { filePreviewKind } from '@/lib/research/file-preview';
import type { ClientOption, MarketOption } from './OrderCalendar';
import { OrderMenu } from './OrderToolbar';
export type { OrderOpportunity } from '@/lib/orders/sources';

export type SourceLink = { id: string; kind?: string; title?: string; label?: string; url?: string; locator?: string };
export type BillingReference = { number: string; year: number; issued: string; amount: number; sources: { label: string; url: string }[] };
type ArchiveLine = Partial<OrderLine> & { id: string; market?: string; flight?: string; impressionsText?: string };
export type ArchiveRecord = {
  id: string; title: string; clientId: string; year: number; marketIds: string[]; market: string; media: string | string[];
  workflow: OrderWorkflow; firm: string; rep: string; orderNumber: string; orderDate: string; amount: number | null;
  impressions: number | null; note?: string; referenceRole?: string; lines: ArchiveLine[];
  signed?: SourceLink | null; latest?: SourceLink | null; related?: SourceLink[];
  billing?: BillingReference | null;
  seedAvailable: boolean;
};
type ArchivePage = { orders: ArchiveRecord[]; total: number; page: number; pageCount: number; availability?: string };
type ResearchPeriod = { label: string; line: OrderLine; source: SourceLink };
type ResearchCell = string | number | null | boolean | { value?: string | number | null; raw?: string | number; unit?: string };
type ResearchRow = {
  id: string; marketId: string; market: string; program: string; firm: string; rep: string; cells: ResearchCell[];
  source: SourceLink | null; line: OrderLine | null; periods?: ResearchPeriod[];
  digitalDraftValues?: DigitalDraftValues;
};
type ResearchPage = {
  columns: { label: string }[]; rows: ResearchRow[]; total: number; page: number; pageCount: number; availability?: string;
  groups?: { label: string; span: number }[];
  filterOptions?: Partial<Record<keyof Filters, string[]>>;
  quoteFacets?: { stations: string[]; prices: number[] };
  groupOptions?: { id: string; label: string }[];
};

export function ordersUrl(parameters: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) if (value !== null && value !== undefined && String(value) !== '') params.set(key, String(value));
  return '/api/orders?' + params.toString();
}

export async function ordersJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.message === 'string' ? value.message
    : typeof value?.error === 'string' ? value.error : 'Orders could not complete the request.');
  return value as T;
}

export function useOrdersQuery<T>(url: string, body?: string) {
  const key = JSON.stringify([url, body]);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: '' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: 'no-store', signal: controller.signal,
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }) })
      .then(ordersJson<T>)
      .then(value => { if (!controller.signal.aborted) setState({ key, value }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Orders could not load.' });
      });
    return () => controller.abort();
  }, [url, key, body, attempt]);
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined,
    busy: Boolean(url && state.key !== key), retry: () => retry(value => value + 1) };
}

function useSettledSearch(query: string) {
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    if (!query) { setSettled(''); return; }
    const timer = window.setTimeout(() => setSettled(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  return query ? settled : '';
}

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const quantity = new Intl.NumberFormat('en-US');

export function Source({ source, previewContext }: {
  source: SourceLink; previewContext?: { market: string; sender: string };
}) {
  const [preview, setPreview] = useState(false);
  const title = source.label ?? source.title ?? 'Original source';
  const url = source.url && (/^https:\/\//.test(source.url) || /^\/api\//.test(source.url)) ? source.url : undefined;
  const canPreview = previewContext && (source.kind === 'broadcast-research' || source.kind === 'broadcast') && filePreviewKind(title);
  return <>
    <span className="ow-source">
      {canPreview ? <button type="button" className="ow-link" onClick={() => setPreview(true)}>{title}</button>
        : url ? <a href={url} target="_blank" rel="noreferrer">{title}</a> : title}
      {source.locator && <> · {source.locator}</>}
    </span>
    {preview && previewContext && <FilePreviewDrawer file={{ id: source.id, name: title, ...previewContext }}
      onClose={() => setPreview(false)} />}
  </>;
}

export function PriorBilling({ reference }: { reference: BillingReference }) {
  return <details className="ow-prior-billing">
    <summary>{reference.year} invoice record</summary>
    <p>{reference.number} · {reference.issued} · {usd.format(reference.amount / 100)}</p>
    <ul>{reference.sources.map(item => <li key={item.url}><Source source={{ id: item.url, ...item }} /></li>)}</ul>
  </details>;
}

function Paging({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  return <div className="ow-bar ow-compact ow-paging" aria-label="Results pages">
    <span>{quantity.format(total)} {total === 1 ? 'result' : 'results'}</span>
    {pageCount > 1 && <>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
    </>}
  </div>;
}

export function HistoricalOrders({ hidden, client, markets, currentYear, canEdit, onSeed, workflow }: {
  hidden: boolean; client: ClientOption | undefined; markets: MarketOption[]; currentYear: number;
  canEdit: boolean; workflow: OrderWorkflow; onSeed: (record: ArchiveRecord, marketId: string) => void;
}) {
  const [year, setYear] = useState(currentYear - 1);
  const [market, setMarket] = useState('');
  const [media, setMedia] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [seedMarket, setSeedMarket] = useState<Record<string, string>>({});
  const search = useSettledSearch(query);
  const { value, error, busy, retry } = useOrdersQuery<ArchivePage>(hidden || !client ? '' :
    ordersUrl({ view: 'archive', clientId: client.id, year, marketId: market, media, q: search, sort, page, workflow }));
  function toggle(id: string) {
    setOpen(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return <section hidden={hidden} aria-label="Historical orders">
    <div className="ow-bar ow-compact">
      <label className="ow-select-label ow-year">Archive year<input type="number" min={1900} max={2100} value={year}
        onChange={event => { setYear(event.target.valueAsNumber || currentYear - 1); setPage(1); }} /></label>
      <OrderMenu aria-label="Historical order market" text={markets.find(item => item.id === market)?.name || 'Markets'} value={market}
        onChange={event => { setMarket(event.target.value); setPage(1); }}>
        <option value="">Markets</option>{markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </OrderMenu>
      {workflow === 'broadcast' && <OrderMenu aria-label="Historical order media" text={media || 'Media'} value={media}
        onChange={event => { setMedia(event.target.value); setPage(1); }}>
        <option value="">Media</option><option>TV</option><option>Radio</option>
      </OrderMenu>}
      <input type="search" aria-label="Search historical orders" placeholder="Search"
        value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
      <OrderMenu aria-label="Sort historical orders" text={sort === 'title' ? 'Title' : sort === 'amount' ? 'Amount' : 'Source order'} value={sort}
        onChange={event => { setSort(event.target.value); setPage(1); }}>
        <option value="">Source order</option><option value="title">Title</option><option value="amount">Amount</option>
      </OrderMenu>
    </div>
    {busy && <p className="ow-empty" role="status">Loading historical orders…</p>}
    {error && <p className="ow-empty" role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {!busy && value && (!value.orders.length ? <p className="ow-empty">{value.availability === 'unconfigured'
      ? 'Historical order sources are not configured.' : 'No historical orders match this view.'}</p> :
      <div className="ow-table-viewport"><table className="ow-table ow-history-table" aria-label="Historical orders and placements">
        <thead><tr>{['Order / Placement', 'Market', 'Media', 'Flight', 'Rate', 'Spots', 'Amount', 'Imps', 'Original documents'].map(label =>
          <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{value.orders.map(item => {
          const pick = seedMarket[item.id] || market || (item.marketIds.length === 1 ? item.marketIds[0] : '');
          return <Fragment key={item.id}>
            <tr className="ow-archive-order">
              <th scope="row"><button type="button" className="ow-link" aria-expanded={open.has(item.id)} onClick={() => toggle(item.id)}>{item.title}</button>
                {item.referenceRole && <small><strong>{item.referenceRole}</strong></small>}
                <small>{[item.orderNumber, item.orderDate, item.firm, item.rep].filter(Boolean).join(' · ')}</small></th>
              <td>{item.market || item.marketIds.map(id => markets.find(row => row.id === id)?.name || id).join(', ')}</td>
              <td>{Array.isArray(item.media) ? item.media.join(', ') : item.media}</td>
              <td colSpan={3}></td>
              <td>{item.amount == null ? '—' : usd.format(item.amount / 100)}</td>
              <td>{item.impressions == null ? '—' : quantity.format(item.impressions)}</td>
              <td>{item.signed && <div><Source source={item.signed} /> <small>Signed</small></div>}
                {item.latest && item.latest.id !== item.signed?.id && <div><Source source={item.latest} /> <small>Latest</small></div>}</td>
            </tr>
            {open.has(item.id) && <tr className="ow-expanded"><td colSpan={9}>
              {item.note && <p>{item.note}</p>}
              {!!item.related?.length && <ul>{item.related.map(source => <li key={source.id}><Source source={source} /></li>)}</ul>}
              {item.billing && <PriorBilling reference={item.billing} />}
              {canEdit && item.seedAvailable && <div className="ow-bar">
                {item.marketIds.length > 1 && <select aria-label={'Draft market for ' + item.title} value={pick}
                  onChange={event => setSeedMarket(previous => ({ ...previous, [item.id]: event.target.value }))}>
                  <option value="">Choose draft market</option>{item.marketIds.map(id =>
                    <option key={id} value={id}>{markets.find(row => row.id === id)?.name || id}</option>)}</select>}
                <button type="button" className="ow-link" disabled={!pick}
                  onClick={() => onSeed(item, pick)}>Start {currentYear} draft from signed order</button>
              </div>}
            </td></tr>}
            {item.lines.map(line => <tr className="ow-archive-placement" key={line.id}>
              <th scope="row">{[line.station, line.program].filter(Boolean).join(' · ') || '—'}
                {(line.format || line.notes) && <small>{[line.format, line.notes].filter(Boolean).join(' · ')}</small>}</th>
              <td>{line.market ?? line.marketId ?? '—'}</td><td>{line.media}</td>
              <td>{line.flight || '—'}{line.days && <small>{line.days}</small>}</td>
              <td>{line.rate == null ? '—' : usd.format(line.rate / 100)}</td><td>{line.quantity ?? '—'}</td>
              <td>{line.amount == null ? '—' : usd.format(line.amount / 100)}</td>
              <td>{line.impressions == null ? line.impressionsText || '—' : quantity.format(line.impressions)}</td><td></td>
            </tr>)}
          </Fragment>;
        })}</tbody>
      </table></div>)}
    {value && <Paging {...value} onPage={setPage} />}
  </section>;
}

export function BroadcastOrderHistory({ client, market, media, planningYear, onBack, onManage }: {
  client: ClientOption; market: MarketOption; media: BroadcastHistoryMedia; planningYear: number;
  onBack: () => void; onManage: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { value, error, busy, retry } = useOrdersQuery<MarketBroadcastHistory>(
    ordersUrl({ view: 'market-history', clientId: client.id, marketId: market.id, media, year: planningYear }));
  const year = planningYear - 1;
  useEffect(() => { heading.current?.focus(); }, []);
  const count = value?.vendors.reduce((total, vendor) => total + vendor.lines.length, 0) ?? 0;
  const money = (amount: number | null) => amount === null ? '—' : usd.format(amount / 100);
  return <section className="ow-market-history" aria-labelledby="market-history-title">
    <div className="ow-history-top">
      <button type="button" className="ow-link" onClick={onBack}>← Back to calendar</button>
      <button type="button" onClick={onManage}>Drafts and linked orders</button>
    </div>
    <div className="ow-history-header">
      <div>
        <h2 id="market-history-title" tabIndex={-1} ref={heading}>{market.name} {media} order</h2>
        <p>{client.name} · {year} historical order</p>
        {!!value?.purchaseOrders.length && <div className="ow-history-sources">
          {value.purchaseOrders.map(source => <Source key={source.id}
            source={{ ...source, label: [source.kind === 'signed-order' ? 'Signed purchase order' : 'Purchase order', source.orderNumber || source.title].join(' ') }} />)}
        </div>}
      </div>
      {!!count && value && <div className="ow-history-total">
        <span>{value.unpricedCount ? 'Priced placement total' : media + ' placement total'}</span>
        <strong>{money(value.amount)}</strong>
        <span>{value.vendors.length} vendor {value.vendors.length === 1 ? 'group' : 'groups'} · {count} {count === 1 ? 'placement' : 'placements'}</span>
        {value.tradeAmount !== null && <span>Trade value {money(value.tradeAmount)}</span>}
        {!!value.unpricedCount && <span>{value.unpricedCount} without a recorded amount</span>}
      </div>}
    </div>
    {busy && <p className="ow-empty" role="status">Loading {media} order…</p>}
    {error && <p className="ow-empty" role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {value && !count && <p className="ow-empty">{value.availability === 'unconfigured'
      ? 'Historical order sources are unavailable.' : 'No ' + year + ' ' + media + ' placements are recorded for ' + market.name + '.'}</p>}
    {!!count && value && <div className="ow-table-viewport">
      <table className="ow-table ow-market-history-table" aria-label={`${market.name} ${media} placements by vendor`}>
        <thead><tr>{['Station / placement', 'Flight', 'Rate', 'Spots', 'Amount', 'Impressions'].map(label =>
          <th scope="col" key={label}>{label}</th>)}</tr></thead>
        {value.vendors.map(vendor => {
          const priced = vendor.lines.filter(line => !line.trade && line.amount !== null);
          const subtotal = priced.length ? priced.reduce((sum, line) => sum + (line.amount ?? 0), 0) : null;
          return <tbody key={vendor.name}>
            <tr className="ow-history-vendor">
              <th scope="rowgroup" colSpan={4}><strong>{vendor.name}</strong>
                {!!vendor.reps.length && <small>{vendor.reps.join(' · ')}</small>}
              </th>
              <td className="ow-history-money">{money(subtotal)}</td>
              <td>{!!vendor.sources.length && <details className="ow-history-docs"><summary>Vendor documents</summary>
                {vendor.sources.map(source => <div key={source.id}><Source source={source} /></div>)}
              </details>}</td>
            </tr>
            {vendor.lines.map(line => <tr key={line.id}>
              <th scope="row"><strong>{line.station || 'Placement'}</strong>{line.program && <span> · {line.program}</span>}
                {(line.format || line.notes) && <small>{[line.format, line.notes].filter(Boolean).join(' · ')}</small>}
              </th>
              <td>{line.flight || '—'}{line.days && <small>{line.days}</small>}</td>
              <td className="ow-history-money">{money(line.rate)}</td>
              <td className="ow-history-money">{line.quantity ?? '—'}</td>
              <td className="ow-history-money">{money(line.amount)}{line.trade && <small>Trade</small>}</td>
              <td className="ow-history-money">{line.impressions == null ? line.impressionsText || '—' : quantity.format(line.impressions)}</td>
            </tr>)}
          </tbody>;
        })}
      </table>
    </div>}
  </section>;
}

const broadcastSheets = { tv: 'TV', radio: 'Radio', 'digital-history': 'Station digital history', demographics: 'Demographics', notes: 'Notes', reference: 'Reference' };
const summaryLabels: Record<string, string> = {
  Station: 'Station', 'Spot rate': 'Rate', CPM: 'CPM', 'Calculated CPM': 'Calc. CPM', 'Reported CPM': 'Rpt. CPM',
  'AQH (people)': 'AQH', 'Audience count': 'Viewers', 'Spot (sec)': 'Sec', 'Spots per week': 'Spots/wk',
  'Gross impressions': 'Imps', 'Extended cost': 'Ext. cost', Audience: 'Demo', Schedule: 'Schedule',
};
const summaryOrder = Object.keys(summaryLabels);

function cellText(cell: ResearchCell | undefined) {
  const raw = typeof cell === 'object' && cell ? cell.value ?? cell.raw : cell;
  if (typeof raw === 'number') {
    const unit = typeof cell === 'object' && cell ? cell.unit : undefined;
    return unit === 'USD' ? usd.format(raw) : quantity.format(raw) + (unit === 'percent' ? '%' : '');
  }
  const text = String(raw ?? '').trim();
  return /^[—–-]+$/.test(text) ? '' : text;
}

type CpmSelection = { exact?: number; low?: number; high?: number };
const selectionLabels = { all: 'All', selected: 'Selected', unselected: 'Not selected' };
const shortlistLabels = { all: 'All', shortlisted: 'Shortlisted', unshortlisted: 'Not shortlisted' };
const spreadsheetColumnPriority = ['Station', 'Spot rate', 'Reported CPM', 'Calculated CPM', 'CPM', 'Audience count',
  'AQH (people)', 'Schedule', 'Audience', 'Spots per week', 'Extended cost', 'Gross impressions'];

function QuoteCpmFields({ prices, value }: { prices: number[]; value: CpmSelection }) {
  const [search, setSearch] = useState('');
  const [exact, setExact] = useState(String(value.exact ?? ''));
  const [low, setLow] = useState(value.low === undefined ? '' : String(value.low / 100));
  const [high, setHigh] = useState(value.high === undefined ? '' : String(value.high / 100));
  const query = search.trim().replace(/[$,]/g, '');
  function useBound(setBound: (amount: string) => void) {
    setBound(String(Number(exact) / 100));
    setExact('');
    setSearch('');
  }
  return <fieldset className="ow-cpm-fields">
      <legend>CPM</legend>
      <label>Find a price<input name="cpmSearch" type="search" value={search} onChange={event=>setSearch(event.target.value)} /></label>
      <label>Exact CPM<select name="exactCpm" value={exact} onChange={event=>setExact(event.target.value)}>
        <option value="">Any price</option>
        {[...new Set([...prices,...(exact===''?[]:[Number(exact)])])].filter(price=>
          String(price)===exact||String((price/100).toFixed(2)).includes(query)).map(price=><option key={price} value={price}>{usd.format(price/100)}</option>)}
      </select></label>
      {exact !== '' && <div className="ow-cpm-uses">
        <button type="button" className="ow-link" onClick={() => useBound(setLow)}>Use as low</button>
        <button type="button" className="ow-link" onClick={() => useBound(setHigh)}>Use as high</button>
      </div>}
      <div className="ow-cpm-range">
        <label>Low CPM<input name="lowCpm" type="number" min="0" max="999999999.99" step="0.01" inputMode="decimal"
          value={low} onChange={event => setLow(event.target.value)} /></label>
        <label>High CPM<input name="highCpm" type="number" min="0" max="999999999.99" step="0.01" inputMode="decimal"
          value={high} onChange={event => setHigh(event.target.value)} /></label>
      </div>
  </fieldset>;
}

function ResearchGroupFields({ groups, grouping }: { groups: { id: string; label: string }[]; grouping: Grouping }) {
  const [primary, setPrimary] = useState(grouping.primary);
  const [secondary, setSecondary] = useState(grouping.secondary);
  return <>
    <label>Group by<select name="primary" value={primary} onChange={event => {
      const next = event.target.value;
      setPrimary(next);
      if (!next || next === secondary) setSecondary('');
    }}><option value="">None</option>{groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
    <label>Subgroup<select name="secondary" value={secondary} disabled={!primary} onChange={event => setSecondary(event.target.value)}>
      <option value="">None</option>{groups.filter(group => group.id !== primary).map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
    </select></label>
  </>;
}

export function OrderResearch({ client, markets, marketIds, workflow, year, initialSheet, document, target, onApply, onRemove, canEdit,
  orderLineSource, spreadsheet = false, hidden = false, persistedState, onView, onStar, shortlistBusy = false }: {
  client: ClientOption; markets: MarketOption[]; marketIds: string[]; workflow: OrderWorkflow; year: number;
  initialSheet: string; document: OrderDocument; target: string | null; onApply: (line: OrderLine, replace: boolean) => void; canEdit: boolean;
  onRemove: (lineId: string) => void; orderLineSource?: ReactNode;
  spreadsheet?: boolean; hidden?: boolean;
  persistedState?: ResearchState|null; onView?: (view:ResearchView)=>void;
  onStar?: (sheet:string,rowId:string,starred:boolean)=>Promise<void>; shortlistBusy?:boolean;
}) {
  const startingMarket = marketIds[0] ?? '';
  const marketLocked = marketIds.length === 1;
  const [sheet, setSheet] = useState(workflow === 'digital' ? 'digital' : initialSheet === 'radio' ? 'radio' : 'tv');
  const hasQuotes = workflow === 'broadcast' && (sheet === 'radio' || sheet === 'tv');
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters, market: markets.find(item => item.id === startingMarket)?.name ?? '',
    client: client.name, rep: workflow === 'broadcast' ? document.rep : '', firm: workflow === 'broadcast' ? document.vendor : '',
  });
  const [grouping, setGrouping] = useState<Grouping>(noGrouping);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [station, setStation] = useState('');
  const [cpm, setCpm] = useState<CpmSelection>({});
  const [selection, setSelection] = useState<keyof typeof selectionLabels>('all');
  const [shortlist, setShortlist] = useState<Set<string>>(() => new Set());
  const [shortlistFilter, setShortlistFilter] = useState<keyof typeof shortlistLabels>('all');
  const [activeQuote, setActiveQuote] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [periodIndexes, setPeriodIndexes] = useState<Record<string, number>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterError, setFilterError] = useState('');
  const filterId = useId();
  const filterRegion = useRef<HTMLDivElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const search = useSettledSearch(query);
  const marketId = marketLocked ? startingMarket : markets.find(item => item.name === filters.market)?.id || startingMarket;
  const canFilterSelection = workflow === 'digital' || hasQuotes;
  const selectedKeys = useMemo(() => new Set(selectedResearchKeys(document.lines)), [document.lines]);
  const filterSelection = canFilterSelection && selection !== 'all';
  const filterShortlist = hasQuotes && shortlistFilter !== 'all';
  const filterBody = filterSelection || filterShortlist ? JSON.stringify({
    ...(filterSelection && { mode: selection, keys: [...selectedKeys] }),
    ...(filterShortlist && { shortlist: { mode: shortlistFilter, ids: [...shortlist] } }),
  }) : undefined;
  const { value, error, busy, retry } = useOrdersQuery<ResearchPage>(!marketId ? '' : ordersUrl({
    view: 'research', clientId: client.id, marketId, year, workflow, sheet, rep: filters.rep, firm: filters.firm,
    q: search, primary: grouping.primary, secondary: grouping.secondary, sort, page,
    ...(hasQuotes && {quoteFilters:1,station,exactCpm:cpm.exact,lowCpm:cpm.low,highCpm:cpm.high}),
  }), filterBody);
  const restoredView=useRef<string|null>(null);
  useEffect(()=>{
    if(!persistedState)return;
    setShortlist(new Set(persistedState.shortlist[sheet]??[]));
    if(restoredView.current===persistedState.orderId)return;
    restoredView.current=persistedState.orderId;
    const saved=persistedState.view;
    if(!saved)return;
    setSheet(saved.sheet);setQuery(saved.q??'');setSort(saved.sort??'');setPage(saved.page??1);setStation(saved.station??'');
    setFilters(current=>({...current,rep:saved.rep??'',firm:saved.firm??''}));
    setGrouping({primary:saved.primary??'',secondary:saved.secondary??''});
    setCpm({exact:saved.exactCpm,low:saved.lowCpm,high:saved.highCpm});
    setSelection(saved.selection??'all');setShortlistFilter(saved.shortlist??'all');
  },[persistedState,sheet]);
  useEffect(()=>{
    onView?.({sheet:sheet as ResearchView['sheet'],q:query,rep:filters.rep,firm:filters.firm,
      station,sort,page,primary:grouping.primary,secondary:grouping.secondary,
      ...(cpm.exact!==undefined&&{exactCpm:cpm.exact}),...(cpm.low!==undefined&&{lowCpm:cpm.low}),
      ...(cpm.high!==undefined&&{highCpm:cpm.high}),selection,shortlist:shortlistFilter,target});
  },[sheet,query,filters.rep,filters.firm,station,sort,page,grouping.primary,grouping.secondary,cpm.exact,cpm.low,cpm.high,selection,shortlistFilter,target,onView]);
  const replacing = document.lines.find(item => item.id === target);
  const options: Record<keyof Filters, string[]> = {
    client: [client.name],
    market: markets.filter(item => client.marketIds.includes(item.id) && (workflow !== 'digital' || marketIds.includes(item.id))).map(item => item.name),
    rep: value?.filterOptions?.rep ?? [...new Set(value?.rows.map(row => row.rep).filter(Boolean) ?? [])],
    firm: value?.filterOptions?.firm ?? [...new Set(value?.rows.map(row => row.firm).filter(Boolean) ?? [])],
  };
  const groups = value?.groupOptions ?? [{ id: 'market', label: 'Market' }, { id: 'rep', label: 'Rep' }, { id: 'firm', label: 'Firm' }];
  const bands = value?.groups?.flatMap(group => Array<string>(group.span).fill(group.label)) ?? [];
  const repeatedFields = new Set(value?.columns.flatMap(({label}, index, columns) =>
    columns.some((column, idx) => idx !== index && column.label === label) ? [label] : []));
  const filtersActive = Boolean(query || filters.rep || filters.firm || (!marketLocked && filters.market !== markets.find(item => item.id === startingMarket)?.name)
    || station || Object.values(cpm).some(price => price !== undefined) || filterSelection || filterShortlist || grouping.primary || sort);
  useEffect(() => {
    if (!filtersOpen || hidden) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !filterRegion.current?.contains(event.target)) setFiltersOpen(false);
    }
    window.document.addEventListener('pointerdown', dismiss);
    return () => window.document.removeEventListener('pointerdown', dismiss);
  }, [filtersOpen, hidden]);
  function resetRows() { setActiveQuote(''); setExpanded(new Set()); setPeriodIndexes({}); }
  function changeQuery() { setPage(1); resetRows(); }
  function closeFilters() {
    setFiltersOpen(false);
    setFilterError('');
    filterTrigger.current?.focus();
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const read = (name: string) => String(fields.get(name) ?? '');
    const price = (name: string) => read(name) === '' ? undefined : Math.round(Number(read(name)) * 100);
    const low = price('lowCpm');
    const high = price('highCpm');
    if (low !== undefined && high !== undefined && low > high) {
      setFilterError('Enter a low CPM no higher than the high CPM.');
      return;
    }
    let exact = read('exactCpm');
    const searchPrice = read('cpmSearch').trim().replace(/[$,]/g, '');
    if (!exact && searchPrice && low === undefined && high === undefined) {
      const matched = value?.quoteFacets?.prices.find(candidate => candidate / 100 === Number(searchPrice));
      if (matched === undefined) {
        setFilterError('Choose an exact CPM or enter a CPM range.');
        return;
      }
      exact = String(matched);
    }
    setFilters({ client: client.name, market: marketLocked ? filters.market : read('market'), rep: read('rep'), firm: read('firm') });
    setCpm({ exact: exact === '' ? undefined : Number(exact), low, high });
    setStation(read('station'));
    setSelection(read('selection') === 'selected' || read('selection') === 'unselected' ? read('selection') as keyof typeof selectionLabels : 'all');
    setShortlistFilter(read('shortlist') === 'shortlisted' || read('shortlist') === 'unshortlisted' ? read('shortlist') as keyof typeof shortlistLabels : 'all');
    setGrouping({ primary: read('primary'), secondary: read('secondary') });
    setSort(read('sort'));
    changeQuery();
    closeFilters();
  }
  function clearFilters() {
    setFilters({ ...emptyFilters, client: client.name, market: markets.find(item => item.id === startingMarket)?.name ?? '' });
    setQuery('');
    setCpm({});
    setStation('');
    setSelection('all');
    setShortlistFilter('all');
    setGrouping(noGrouping);
    setSort('');
    changeQuery();
    closeFilters();
  }
  function toggleExpanded(id: string) {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function openQuote(id: string) {
    setActiveQuote(id);
    setExpanded(current => new Set(current).add(id));
  }
  function toggleShortlist(id: string) {
    if(onStar){void onStar(sheet,id,!shortlist.has(id)).catch(()=>{});return;}
    setShortlist(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    if (filterShortlist) setPage(1);
  }
  function quoteFor(row: ResearchRow) {
    const periodIndex = periodIndexes[row.id] ?? (row.periods?.length === 1 ? 0 : -1);
    return row.periods?.length ? row.periods[periodIndex]?.line : row.line && { ...row.line, ...row.digitalDraftValues };
  }
  const shortlistQuotes = spreadsheet && hasQuotes && canEdit ? (value?.rows ?? []).flatMap(row => {
    if (!shortlist.has(row.id) || isResearchSelected(row, selectedKeys)) return [];
    const quote = quoteFor(row);
    return quote && marketIds.includes(quote.marketId) ? [quote] : [];
  }) : [];
  const sheetColumns = spreadsheet ? (value?.columns ?? []).map((column, idx) => {
    const priority = spreadsheetColumnPriority.indexOf(column.label);
    return { idx, priority: priority < 0 ? spreadsheetColumnPriority.length : priority, label: column.label,
      title: repeatedFields.has(column.label) && bands[idx] ? bands[idx] + ' ' + column.label : column.label };
  }).sort((a, b) => a.priority - b.priority) : [];
  const rows = value?.rows.map((row, index) => {
      const groupValue = (item: ResearchRow, key: string) => key === 'market' ? item.market : key === 'firm' ? item.firm : key === 'rep' ? item.rep : '';
      const previous = value.rows[index - 1];
      const first = groupValue(row, grouping.primary);
      const second = groupValue(row, grouping.secondary);
      const periodIndex = periodIndexes[row.id] ?? (row.periods?.length === 1 ? 0 : -1);
      const chosenPeriod = row.periods?.[periodIndex];
      const line = quoteFor(row);
      const canAdd = Boolean(line && marketIds.includes(line.marketId));
      const canReplace = Boolean(canAdd && replacing && line?.marketId === replacing.marketId);
      const canSelect = canEdit && (workflow === 'digital' || hasQuotes) && Boolean(row.line || row.periods?.length);
      const onOrder = isResearchSelected(row, selectedKeys);
      const selectLabel = onOrder ? 'Selected' : 'Select';
      const expandedRow = expanded.has(row.id);
      const matchingLines = canSelect && onOrder && expandedRow
        ? document.lines.flatMap((placement, index) => isResearchSelected(row, new Set(selectedResearchKeys([placement])))
          ? [{ id: placement.id, number: index + 1 }] : [])
        : [];
      const seen = new Set<string>();
      const fields = value.columns.flatMap((column, idx) => {
        const value = cellText(row.cells[idx]);
        if (!value || ['Channel', 'Program', 'Daypart'].includes(column.label) && value === row.program) return [];
        const label = repeatedFields.has(column.label) && bands[idx] ? bands[idx] + ' ' + column.label : column.label;
        const key = JSON.stringify([label, value]);
        if (seen.has(key)) return [];
        seen.add(key);
        const cell = row.cells[idx];
        const locator = typeof cell === 'object' && cell !== null && 'locator' in cell &&
          typeof cell.locator === 'string' ? cell.locator : undefined;
        return [{ label, value, idx, locator, summary: workflow === 'broadcast' ? summaryLabels[label] : undefined }];
      });
      const headline = fields.filter(field => field.summary)
        .sort((a, b) => summaryOrder.indexOf(a.label) - summaryOrder.indexOf(b.label));
      const details = fields.filter(field => !field.summary);
      const detailGroups = new Map<string, typeof details>();
      for (const field of details) {
        const year = workflow === 'digital' ? field.label.match(/^\d{4}\b/)?.[0] ?? '' : '';
        const group = detailGroups.get(year);
        if (group) group.push(field);
        else detailGroups.set(year, [field]);
      }
      const detailContent = <div className="ow-research-details">
            {[...detailGroups].map(([year, items]) => <dl key={year}>{items.map(item =>
              <div key={item.idx}><dt>{item.label}</dt><dd title={item.locator || undefined}>{item.value}</dd></div>)}</dl>)}
            {workflow === 'digital' && details.every(field => !/^\d{4}\b/.test(field.label)) &&
              <p className="ow-research-no-history">No spend or impressions recorded for this placement in {row.market}.</p>}
            {(chosenPeriod?.source || row.source) && <Source source={chosenPeriod?.source ?? row.source!}
              previewContext={{ market: row.market, sender: [row.rep, row.firm].filter(Boolean).join(' · ') || 'Published research' }} />}
            {!!row.periods && row.periods.length > 1 && <label>Quoted period
              <select value={periodIndex} onChange={event => {
                const next = Number(event.target.value);
                setPeriodIndexes(current => ({ ...current, [row.id]: next }));
              }}>
                <option value={-1}>Choose period</option>
                {row.periods.map((period, idx) => <option key={period.label + idx} value={idx}>{period.label}</option>)}
              </select></label>}
            {(matchingLines.length > 0 || canSelect && activeQuote === row.id) && <div className="ow-bar ow-compact">
              {matchingLines.map(placement => <button className="ow-link" key={placement.id} type="button"
                aria-label={'Unselect ' + (row.program || 'research entry') + ', line ' + placement.number}
                onClick={() => { onRemove(placement.id); if (selection !== 'all') setPage(1); }}>
                {matchingLines.length > 1 ? 'Unselect line ' + placement.number : 'Unselect'}
              </button>)}
              {canSelect && activeQuote === row.id && <>
                <button className="ow-link" disabled={!canAdd} type="button" onClick={() => line && onApply(line, false)}>Add line</button>
                <button className="ow-link" disabled={!canReplace}
                  type="button" onClick={() => line && onApply(line, true)}>
                  {replacing ? 'Replace ' + (replacing.program || 'selected line') : 'Replace selected line'}
                </button>
                {line && !canAdd && <span>Choose research for a market on this order to add a line.</span>}
                {canAdd && row.digitalDraftValues?.amount == null && row.digitalDraftValues?.impressions == null && row.digitalDraftValues &&
                  <span>The workbook has no media spend or impressions for this channel in this market.</span>}
              </>}
            </div>}
          </div>;
      const newFirst = first && (!previous || groupValue(previous, grouping.primary) !== first);
      const newSecond = second && (!previous || newFirst || groupValue(previous, grouping.secondary) !== second);
      const label = row.program || 'Research entry';
      if (spreadsheet) {
        const columns = sheetColumns.length + 4;
        const marked = shortlist.has(row.id);
        return <Fragment key={row.id}>
          {newFirst && <tr className="ow-sheet-group"><td colSpan={columns}>{first}</td></tr>}
          {newSecond && <tr className="ow-sheet-group"><td colSpan={columns}>{second}</td></tr>}
          <tr className="ow-sheet-quote" data-selected={onOrder} data-shortlisted={marked}>
            <td className="ow-sheet-picks">
              {hasQuotes && <button className="ow-link ow-sheet-star" type="button" disabled={shortlistBusy||!canEdit} aria-pressed={marked}
                title={marked ? 'Remove from shortlist' : 'Shortlist'}
                aria-label={(marked ? 'Unshortlist ' : 'Shortlist ') + label}
                onClick={() => toggleShortlist(row.id)}>{marked ? '★' : '☆'}</button>}
              {canSelect ? <button className="ow-link ow-sheet-add" type="button"
                title={onOrder ? 'Selected' : 'Add to order'} aria-label={(onOrder ? 'Selected ' : 'Add ') + label}
                onClick={() => {
                  if (onOrder || !line || !canAdd) openQuote(row.id);
                  else { onApply(line, false); if (filterSelection) setPage(1); }
                }}>{onOrder ? '✓' : '+'}</button> : onOrder && <span title="Selected" aria-label="Selected">✓</span>}
            </td>
            <td className="ow-sheet-program"><button className="ow-link ow-sheet-placement" type="button" aria-expanded={expandedRow}
              onClick={() => { toggleExpanded(row.id); setActiveQuote(row.id); }}>{label}</button></td>
            {sheetColumns.map(field => {
              const cell = cellText(row.cells[field.idx]);
              return <td key={field.idx} title={cell || 'Not provided in source'}>{cell || '—'}</td>;
            })}
            <td>{row.firm || '—'}</td><td>{row.rep || '—'}</td>
          </tr>
          {expandedRow && <tr className="ow-sheet-quote-details"><td colSpan={columns}>{detailContent}</td></tr>}
        </Fragment>;
      }
      return <Fragment key={row.id}>
        {newFirst && <h4 className="ow-research-group">{first}</h4>}
        {newSecond && <h5 className="ow-research-group">{second}</h5>}
        <div className="ow-research-result" data-selectable={canSelect || onOrder} data-active={activeQuote === row.id} data-selected={onOrder}>
        <details className="ow-research-record" open={expandedRow}>
          <summary onClick={event => {
            event.preventDefault();
            toggleExpanded(row.id);
          }}><span className="ow-research-headline">
            <strong>{row.program || 'Research entry'}</strong>
            {workflow === 'digital' && <span>{row.market}</span>}
            {headline.map(item => <span key={item.idx} className="ow-research-metric"><b>{item.summary}</b> {item.value}</span>)}
          </span></summary>
          {detailContent}
        </details>
        {canSelect ? <button type="button" className="ow-link ow-research-select" aria-label={`${selectLabel} ${row.program || 'research entry'}`}
          onClick={() => openQuote(row.id)}>{selectLabel}</button> : onOrder && <span className="ow-research-select">Selected</span>}
        </div>
      </Fragment>;
    });
  return <aside className={'ow-research' + (spreadsheet ? ' ow-research-sheet' : '')} aria-label="Order research" hidden={hidden}>
    <div className="ow-research-title"><h3>{workflow === 'digital' ? 'Digital campaign research' : 'Broadcast research'}</h3>
      <div className="ow-research-heading-tools">
        <input type="search" aria-label="Search order research" placeholder="Search" value={query}
        onChange={event => { setQuery(event.target.value); changeQuery(); }} />
        {workflow === 'broadcast' && <div className="ow-research-filter-trigger" ref={filterRegion} onKeyDown={event => {
          if (event.key === 'Escape' && filtersOpen) {
            event.stopPropagation();
            closeFilters();
          }
        }}>
          <button type="button" ref={filterTrigger} className="ow-filter-icon" aria-label="Research filters" title="Research filters"
            aria-expanded={filtersOpen} aria-controls={filtersOpen ? filterId : undefined} data-active={filtersActive}
            onClick={() => { setFilterError(''); setFiltersOpen(open => !open); }}>
            <span aria-hidden="true" />
          </button>
          <button type="button" className="ow-link" onClick={clearFilters} disabled={!filtersActive && !filtersOpen}>Clear filters</button>
          {filtersOpen && <form id={filterId} className="ow-research-filter-panel" aria-label="Research filters" onSubmit={applyFilters}
            onChange={() => setFilterError('')}>
            <div className="ow-filter-fields">
              {!marketLocked && <label>Market<select name="market" defaultValue={filters.market}>
                {options.market.map(market => <option key={market}>{market}</option>)}
              </select></label>}
              {(['rep', 'firm'] as const).map(field => <label key={field}>{field === 'rep' ? 'Rep' : 'Firm'}
                <select name={field} defaultValue={filters[field]}>
                  <option value="">{field === 'rep' ? 'All reps' : 'All firms'}</option>
                  {[...new Set([filters[field], ...options[field]])].filter(Boolean).map(choice => <option key={choice}>{choice}</option>)}
                </select>
              </label>)}
              {hasQuotes && <label>Station<select name="station" defaultValue={station}>
                <option value="">All stations</option>
                {[...new Set([station, ...(value?.quoteFacets?.stations ?? [])])].filter(Boolean).map(item => <option key={item}>{item}</option>)}
              </select></label>}
              {canFilterSelection && <label>Selection<select name="selection" aria-label="Research selection" defaultValue={selection}>
                {Object.entries(selectionLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
              </select></label>}
              {hasQuotes && (spreadsheet || shortlist.size > 0 || filterShortlist) &&
                <label>Shortlist<select name="shortlist" aria-label="Research shortlist" defaultValue={shortlistFilter}>
                  {Object.entries(shortlistLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                </select></label>}
              <ResearchGroupFields groups={groups} grouping={grouping} />
              <label>Sort by<select name="sort" defaultValue={sort}>
                <option value="">Source order</option><option value="program">Placement</option><option value="amount">Amount</option>
                <option value="impressions">Impressions</option>
              </select></label>
            </div>
            {hasQuotes && <QuoteCpmFields prices={value?.quoteFacets?.prices ?? []} value={cpm} />}
            {filterError && <p className="ow-filter-error" role="alert">{filterError}</p>}
            <button type="submit" className="ow-link">Apply filters</button>
          </form>}
        </div>}
      </div>
    </div>
    {orderLineSource}
    {workflow === 'broadcast' && <div className="ow-sheet-tabs" role="group" aria-label="Research sheets">
      {Object.entries(broadcastSheets).map(([key, title]) => <button type="button" key={key} aria-pressed={sheet === key}
        onClick={() => { setSheet(key); setStation(''); setCpm({}); changeQuery(); }}>{title}</button>)}
    </div>}
    {workflow === 'digital' && <div className="ow-research-filters">
      <FilterRibbon filters={filters} options={options} fields={marketLocked ? ['rep','firm'] : ['market','rep','firm']}
        onChange={next => { setFilters({ ...next, client: client.name }); changeQuery(); }}>
        {canFilterSelection && <OrderMenu aria-label="Research selection" text={selection === 'all' ? 'Selection' : selectionLabels[selection]}
          value={selection} onChange={event => { setSelection(event.target.value as keyof typeof selectionLabels); changeQuery(); }}>
          {Object.entries(selectionLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </OrderMenu>}
        <GroupControl choices={groups} grouping={grouping} onChange={next => { setGrouping(next); changeQuery(); }} />
        <OrderMenu aria-label="Sort order research" text={sort === 'program' ? 'Placement' : sort === 'amount' ? 'Amount' : sort === 'impressions' ? 'Impressions' : 'Source order'}
          value={sort} onChange={event => { setSort(event.target.value); changeQuery(); }}>
          <option value="">Source order</option><option value="program">Placement</option><option value="amount">Amount</option>
          <option value="impressions">Impressions</option>
        </OrderMenu>
      </FilterRibbon>
    </div>}
    {busy && <p className="ow-empty" role="status">Loading research…</p>}
    {error && <p className="ow-empty" role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {!busy && value && !value.rows.length && <p className="ow-empty">{value.availability === 'unconfigured'
      ? 'This research source is not configured.' : canFilterSelection && selection === 'selected'
        ? 'No selected research matches these filters.' : 'No research matches these filters.'}</p>}
    {spreadsheet ? <div className="ow-sheet-scroll" role="region" aria-label="Scroll research results" tabIndex={0}>
      <table className="ow-sheet-table ow-research-grid" aria-label="Research spreadsheet results">
        <thead><tr><th scope="col" className="ow-sheet-picks">Pick</th>
          <th scope="col" className="ow-sheet-program">Placement</th>
          {sheetColumns.map(field => <th key={field.idx} scope="col" title={field.title}>{summaryLabels[field.label] ?? field.title}</th>)}
          <th scope="col">Firm</th><th scope="col">Rep</th>
        </tr></thead><tbody>{rows}</tbody>
      </table>
    </div> : rows}
    {value && (spreadsheet ? <div className="ow-sheet-research-footer">
      <Paging {...value} onPage={next => { setPage(next); resetRows(); }} />
      {!!shortlistQuotes.length && <button type="button" className="ow-link" onClick={() => {
        shortlistQuotes.forEach(quote => onApply(quote, false));
        if (filterSelection) setPage(1);
      }}>Add shown shortlist ({shortlistQuotes.length})</button>}
    </div> : <Paging {...value} onPage={next => { setPage(next); resetRows(); }} />)}
  </aside>;
}
