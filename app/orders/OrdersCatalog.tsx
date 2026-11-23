import { Fragment, useEffect, useState } from 'react';
import FilePreviewDrawer from '@/app/research/_components/FilePreviewDrawer';
import FilterRibbon, { emptyFilters, type Filters } from '@/app/research/broadcast/FilterRibbon';
import GroupControl, { noGrouping, type Grouping } from '@/app/research/broadcast/GroupControl';
import type { DigitalDraftValues } from '@/lib/orders/sources';
import type { OrderDocument, OrderLine, OrderWorkflow } from '@/lib/orders/store';
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

export function useOrdersGet<T>(url: string) {
  const [state, setState] = useState<{ url: string; value?: T; error?: string }>({ url: '' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(ordersJson<T>)
      .then(value => { if (!controller.signal.aborted) setState({ url, value }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ url, error: error instanceof Error ? error.message : 'Orders could not load.' });
      });
    return () => controller.abort();
  }, [url, attempt]);
  return { value: state.url === url ? state.value : undefined, error: state.url === url ? state.error : undefined,
    busy: Boolean(url && state.url !== url), retry: () => retry(value => value + 1) };
}

function useSettledSearch(query: string) {
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    if (!query) { setSettled(''); return; }
    const timer = window.setTimeout(() => setSettled(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  return settled;
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

export function HistoricalOrders({ hidden, client, markets, currentYear, canEdit, onSeed }: {
  hidden: boolean; client: ClientOption | undefined; markets: MarketOption[]; currentYear: number;
  canEdit: boolean; onSeed: (record: ArchiveRecord, marketId: string) => void;
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
  const { value, error, busy, retry } = useOrdersGet<ArchivePage>(hidden || !client ? '' :
    ordersUrl({ view: 'archive', clientId: client.id, year, marketId: market, media, q: search, sort, page }));
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
      <OrderMenu aria-label="Historical order media" text={media || 'Media'} value={media}
        onChange={event => { setMedia(event.target.value); setPage(1); }}>
        <option value="">Media</option><option>TV</option><option>Radio</option><option>Digital</option>
      </OrderMenu>
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

const broadcastSheets = { tv: 'TV', radio: 'Radio', 'digital-history': 'Station digital history', demographics: 'Demographics', notes: 'Notes', reference: 'Reference' };
const summaryLabels: Record<string, string> = {
  Station: 'Station', Schedule: 'Schedule', Period: 'Period', 'Spot rate': 'Rate', 'AQH (people)': 'AQH', 'Audience count': 'Viewers',
  'Reported CPM': 'Rpt. CPM', CPM: 'CPM', 'Spot (sec)': 'Sec', 'Spots per week': 'Spots/wk',
  'Gross impressions': 'Imps', 'Extended cost': 'Ext. cost', Audience: 'Demo',
};

function cellText(cell: ResearchCell | undefined) {
  const raw = typeof cell === 'object' && cell ? cell.value ?? cell.raw : cell;
  if (typeof raw === 'number') {
    const unit = typeof cell === 'object' && cell ? cell.unit : undefined;
    return unit === 'USD' ? usd.format(raw) : quantity.format(raw) + (unit === 'percent' ? '%' : '');
  }
  const text = String(raw ?? '').trim();
  return /^[—–-]+$/.test(text) ? '' : text;
}

export function OrderResearch({ client, markets, marketIds, workflow, year, initialSheet, document, target, onApply, canEdit }: {
  client: ClientOption; markets: MarketOption[]; marketIds: string[]; workflow: OrderWorkflow; year: number;
  initialSheet: string; document: OrderDocument; target: string | null; onApply: (line: OrderLine, replace: boolean) => void; canEdit: boolean;
}) {
  const startingMarket = marketIds[0] ?? '';
  const [sheet, setSheet] = useState(workflow === 'digital' ? 'digital' : initialSheet === 'radio' ? 'radio' : 'tv');
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters, market: markets.find(item => item.id === startingMarket)?.name ?? '',
    client: client.name, rep: workflow === 'broadcast' ? document.rep : '', firm: workflow === 'broadcast' ? document.vendor : '',
  });
  const [grouping, setGrouping] = useState<Grouping>(noGrouping);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [periodIndexes, setPeriodIndexes] = useState<Record<string, number>>({});
  const search = useSettledSearch(query);
  const marketId = markets.find(item => item.name === filters.market)?.id || startingMarket;
  const { value, error, busy, retry } = useOrdersGet<ResearchPage>(!marketId ? '' : ordersUrl({
    view: 'research', clientId: client.id, marketId, year, workflow, sheet, rep: filters.rep, firm: filters.firm,
    q: search, primary: grouping.primary, secondary: grouping.secondary, sort, page,
  }));
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
  function resetRows() { setSelected(''); setExpanded(new Set()); setPeriodIndexes({}); }
  function changeQuery() { setPage(1); resetRows(); }
  return <aside className="ow-research" aria-label="Order research">
    <h3>{workflow === 'digital' ? 'Digital campaign research' : 'Broadcast research'}</h3>
    {workflow === 'broadcast' && <div className="ow-sheet-tabs" role="group" aria-label="Research sheets">
      {Object.entries(broadcastSheets).map(([key, title]) => <button type="button" key={key} aria-pressed={sheet === key}
        onClick={() => { setSheet(key); changeQuery(); }}>{title}</button>)}
    </div>}
    <div className="ow-research-filters">
      <FilterRibbon filters={filters} options={options} onChange={next => { setFilters({ ...next, client: client.name }); changeQuery(); }}>
        <GroupControl choices={groups} grouping={grouping} onChange={next => { setGrouping(next); changeQuery(); }} />
      </FilterRibbon>
    </div>
    <div className="ow-bar ow-compact">
      <input type="search" aria-label="Search order research" placeholder="Search" value={query}
        onChange={event => { setQuery(event.target.value); changeQuery(); }} />
      <select aria-label="Sort order research" value={sort} onChange={event => { setSort(event.target.value); changeQuery(); }}>
        <option value="">Source order</option><option value="program">Placement</option><option value="amount">Amount</option>
        <option value="impressions">Impressions</option>
      </select>
    </div>
    {busy && <p className="ow-empty" role="status">Loading research…</p>}
    {error && <p className="ow-empty" role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {!busy && value && !value.rows.length && <p className="ow-empty">{value.availability === 'unconfigured'
      ? 'This research source is not configured.' : 'No research matches these filters.'}</p>}
    {value?.rows.map((row, index) => {
      const groupValue = (item: ResearchRow, key: string) => key === 'market' ? item.market : key === 'firm' ? item.firm : key === 'rep' ? item.rep : '';
      const previous = value.rows[index - 1];
      const first = groupValue(row, grouping.primary);
      const second = groupValue(row, grouping.secondary);
      const periodIndex = periodIndexes[row.id] ?? (row.periods?.length === 1 ? 0 : -1);
      const chosenPeriod = row.periods?.[periodIndex];
      const line = row.periods?.length ? chosenPeriod?.line
        : row.line && { ...row.line, ...row.digitalDraftValues };
      const canAdd = Boolean(line && marketIds.includes(line.marketId));
      const canReplace = Boolean(canAdd && replacing && line?.marketId === replacing.marketId);
      const canSelect = canEdit && Boolean(row.line || row.periods?.length);
      const seen = new Set<string>();
      const fields = value.columns.flatMap((column, idx) => {
        const value = cellText(row.cells[idx]);
        if (!value || ['Channel', 'Program', 'Daypart'].includes(column.label) && value === row.program) return [];
        const label = repeatedFields.has(column.label) && bands[idx] ? bands[idx] + ' ' + column.label : column.label;
        const key = JSON.stringify([label, value]);
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ label, value, idx, summary: workflow === 'broadcast' ? summaryLabels[label] : undefined }];
      });
      const headline = fields.filter(field => field.summary);
      const details = fields.filter(field => !field.summary);
      return <Fragment key={row.id}>
        {first && (!previous || groupValue(previous, grouping.primary) !== first) && <h4 className="ow-research-group">{first}</h4>}
        {second && (!previous || groupValue(previous, grouping.primary) !== first || groupValue(previous, grouping.secondary) !== second) &&
          <h5 className="ow-research-group">{second}</h5>}
        <div className="ow-research-result" data-selectable={canSelect} data-selected={selected === row.id}>
        <details className="ow-research-record" open={expanded.has(row.id)}>
          <summary onClick={event => {
            event.preventDefault();
            setExpanded(current => {
              const next = new Set(current);
              if (!next.delete(row.id)) next.add(row.id);
              return next;
            });
          }}><span className="ow-research-headline">
            <strong>{row.program || 'Research entry'}</strong>
            {workflow === 'digital' && <span>{row.market}</span>}
            {headline.map(item => <span key={item.idx} className="ow-research-metric"><b>{item.summary}</b> {item.value}</span>)}
          </span></summary>
          <div className="ow-research-details">
            {!!details.length && <dl>{details.map(item =>
              <div key={item.idx}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
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
            {canSelect && selected === row.id && <div className="ow-bar ow-compact">
              <button className="ow-link" disabled={!canAdd} type="button" onClick={() => line && onApply(line, false)}>Add line</button>
              <button className="ow-link" disabled={!canReplace}
                type="button" onClick={() => line && onApply(line, true)}>
                {replacing ? 'Replace ' + (replacing.program || 'selected line') : 'Replace selected line'}
              </button>
              {line && !canAdd && <span>Choose research for a market on this order to add a line.</span>}
              {canAdd && row.digitalDraftValues?.amount == null && row.digitalDraftValues?.impressions == null && row.digitalDraftValues &&
                <span>The workbook has no media spend or impressions for this channel in this market.</span>}
            </div>}
          </div>
        </details>
        {canSelect && <button type="button" className="ow-link ow-research-select" aria-label={`Select ${row.program || 'research entry'}`}
          onClick={() => {
            setSelected(row.id);
            setExpanded(current => new Set(current).add(row.id));
          }}>Select</button>}
        </div>
      </Fragment>;
    })}
    {value && <Paging {...value} onPage={next => { setPage(next); resetRows(); }} />}
  </aside>;
}
