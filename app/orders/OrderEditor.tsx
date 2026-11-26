import { Fragment, createContext,useContext,useCallback, useEffect, useRef, useState } from 'react';
import { calculatedOrderCpm, orderLineCharges, replaceResearchLine, spreadsheetScheduleChanges } from '@/lib/orders/metrics';
import type { OrderDetail, OrderDocument, OrderEvent, OrderIssue, OrderLine, OrderWorkflow } from '@/lib/orders/store';
import { OrderAssistantChanges } from './OrderAssistantChanges';
import { useDraftSync } from './useDraftSync';
import { useOrderResearchState,assistantRequest } from './useOrderResearchState';
import { isMarketOrder } from '@/lib/orders/market-order';
import { parseEditorValue, type EditorValueType } from '@/lib/orders/editor-values';
import { orderPdfMarkup } from '@/lib/orders/print-markup';
import { orderVendorGroups, orderVendorLabel } from '@/lib/orders/vendor-groups';
import type { ResearchView } from '@/lib/order-assistant/types';
import { displayTime, OrdersDialog, type ClientOption, type MarketOption, type Mutate } from './OrderCalendar';
import { OrderResearch, ordersJson, ordersUrl, PriorBilling, quantity, Source, usd, type BillingReference } from './OrdersCatalog';

export type OpenOrder = {
  document: OrderDocument; clientId: string; year: number; workflow: OrderWorkflow; marketIds: string[];
  originKey?: string; firmId?: string; repId?: string; archiveId?: string | null; seed?: unknown; order?: OrderDetail;
  marketProposed?: number | null; editorKey?:string;
};

type OrderEditorProps = {
  selection: OpenOrder; client: ClientOption; markets: MarketOption[]; canEdit: boolean; busy: boolean;
  fromCalendar: boolean; planUrl?: string; sheet: string; mutate: Mutate; onDirty: (dirty: boolean) => void; onBack: () => void;
  onCancel?: () => void;
  onSave: (document: OrderDocument) => Promise<OrderDetail | undefined>;
  onUpdate: (order: OrderDetail) => void; onDownload: (issueId: string) => Promise<void>;
};

const headerLabels = {
  date: 'Order Date', vendor: 'Media Vendor', number: 'Order No.', terms: 'Terms', clientName: 'Client',
  buyer: 'Buyer Contact', buyerEmail: 'Buyer email', billing: 'Billing Contact',
  rep: 'Representative', start: 'Flight start', end: 'Flight end', notes: 'Notes',
} as const;
type HeaderKey = keyof typeof headerLabels;
const lineLabels = {
  station: 'Station', program: 'Placement / program', format: 'Format', days: 'Run days', start: 'Start', end: 'End',
  rate: 'Spot rate', quantity: 'Spots', amount: 'Amount', impressions: 'Impressions', notes: 'Notes',
  feeBasisPoints: 'Fee %', spotsPerDay: 'Spots per day', spotsPerWeek: 'Spots per week', weeks: 'Weeks', audience: 'Audience', cpm: 'CPM',
} as const;
type LineKey = keyof typeof lineLabels;
type FieldType = EditorValueType;
const FieldRecovery=createContext<{fields:Record<string,string>;change:(key:string,value:string|null)=>void}>({fields:{},change:()=>{}});

function PlacementCell({ label, children }: { label?: string; children: React.ReactNode }) {
  return <td role="cell" data-label={label}>{children}</td>;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueLabel(value: unknown, type: FieldType = 'text') {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money' && typeof value === 'number') return usd.format(value / 100);
  if (type === 'percent' && typeof value === 'number') return quantity.format(value / 100) + '%';
  if ((type === 'number' || type === 'decimal') && typeof value === 'number') return quantity.format(value);
  return String(value);
}

function PaperValue({ value, type = 'text', label, changed, readOnly, onChange, missing, spreadsheet = false, max, fieldKey = label }: {
  value: string | number | null; type?: FieldType; label: string; changed?: boolean;
  readOnly: boolean; onChange: (value: string | number | null) => void; missing?: string;
  spreadsheet?: boolean; max?: number; fieldKey?:string;
}) {
  const recovery=useContext(FieldRecovery);
  const raw=recovery.fields[fieldKey];
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const original = useRef(value);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const numeric = type === 'money' || type === 'percent' || type === 'number' || type === 'decimal';
  function applyInput() {
    const current=input.current;
    if(!current)return false;
    recovery.change(fieldKey,current.value);
    const parsed=parseEditorValue(current.value,type,max);
    current.setCustomValidity(parsed.valid?'':'Complete this field with a valid value.');
    if(!parsed.valid)return false;
    if(parsed.value!==value)onChange(parsed.value);
    return true;
  }
  const attrs = {
    ref: input, 'aria-label': label, defaultValue: raw ?? ((type === 'money' || type === 'percent') && typeof value === 'number' ? value / 100 : value ?? ''),
    onChange: () => { applyInput(); },
    onBlur: () => {
      if(applyInput())recovery.change(fieldKey,null);
      setEditing(false);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        recovery.change(fieldKey,null);
        onChange(original.current);
        setEditing(false);
        if (spreadsheet) window.requestAnimationFrame(() => editButton.current?.focus());
      }
      if (event.key === 'Enter' && type !== 'multiline') {
        event.preventDefault();
        const cell = spreadsheet ? input.current?.closest<HTMLTableCellElement>('td[data-field]') : undefined;
        const row = cell?.parentElement;
        const adjacent = event.shiftKey ? row?.previousElementSibling : row?.nextElementSibling;
        const next = cell && adjacent?.querySelector<HTMLButtonElement>(`td[data-field="${cell.dataset.field}"] button`);
        input.current?.blur();
        if (spreadsheet) window.requestAnimationFrame(() => (next?.isConnected ? next : editButton.current)?.focus());
      }
    },
  };
  const display=raw!==undefined ? raw+' (needs review)' : value==null && missing ? missing : valueLabel(value,type);
  return readOnly ? <span>{display}</span>
    : editing && type === 'multiline' ? <textarea {...attrs} />
    : editing ? <input {...attrs} type="text" inputMode={numeric?'decimal':undefined} placeholder={type==='date'?'YYYY-MM-DD':undefined} aria-invalid={raw!==undefined&&!parseEditorValue(raw,type,max).valid}
      min={numeric ? 0 : undefined} max={max} step={type === 'money' || type === 'percent' ? '0.01' : type === 'number' ? '1' : type === 'decimal' ? 'any' : undefined} />
    : <button ref={editButton} type="button" title={'Edit ' + label} aria-label={'Edit ' + label} onClick={() => { original.current = value; setEditing(true); }}
      className={spreadsheet ? 'ow-sheet-cell' : 'ow-paper-value'} data-changed={changed}>
      {display}{!spreadsheet && <span aria-hidden="true">✎</span>}
    </button>;
}

const sheetHeaders = ['date', 'number', 'vendor', 'rep', 'terms', 'clientName', 'buyer', 'buyerEmail', 'billing', 'start', 'end', 'notes'] as const;
type SheetColumn = { key: Exclude<keyof OrderLine, 'noCharge' | 'source'> | 'managementFee' | 'amountDue'; title: string; type?: FieldType; max?: number };
const sheetPlacements: SheetColumn[] = [
  { key: 'station', title: 'Station' }, { key: 'program', title: 'Placement / program' },
  { key: 'rate', title: 'Booked rate', type: 'money' },
  { key: 'spotsPerWeek', title: 'Ads/wk', type: 'number', max: 100_000 },
  { key: 'weeks', title: 'Weeks', type: 'decimal', max: 520 },
  { key: 'amount', title: 'Total $', type: 'money' },
  { key: 'quantity', title: 'Spots', type: 'number', max: 1_000_000_000 },
  { key: 'impressions', title: 'Gross imps', type: 'number', max: 1_000_000_000 },
  { key: 'calculatedCpm', title: 'Calc. CPM', type: 'money' },
  { key: 'audience', title: 'Audience', type: 'number', max: 1_000_000_000 },
  { key: 'reportedCpm', title: 'Rpt. CPM', type: 'money' },
  { key: 'format', title: 'Format' }, { key: 'days', title: 'Run days' },
  { key: 'start', title: 'Flight start', type: 'date' }, { key: 'end', title: 'Flight end', type: 'date' },
];
const digitalPlacements: SheetColumn[] = [
  { key: 'program', title: 'Placement' }, { key: 'format', title: 'Format' },
  { key: 'days', title: 'Run days' }, { key: 'weeks', title: 'Weeks', type: 'decimal', max: 520 },
  { key: 'start', title: 'Flight start', type: 'date' }, { key: 'end', title: 'Flight end', type: 'date' },
  { key: 'amount', title: 'Media amount', type: 'money', max: 1_000_000_000 },
  { key: 'feeBasisPoints', title: 'Fee %', type: 'percent', max: 100 },
  { key: 'managementFee', title: 'Management fee', type: 'money' },
  { key: 'amountDue', title: 'Amount due', type: 'money' },
  { key: 'impressions', title: 'Impressions', type: 'number', max: 1_000_000_000 },
  { key: 'calculatedCpm', title: 'Calc. CPM', type: 'money' },
  { key: 'notes', title: 'Notes', type: 'multiline' },
];

function OrderSpreadsheetDetails({ document, baseline, detailsOpen, onToggleDetails, onHeader, readOnly }: {
  document: OrderDocument; baseline: OrderDocument; detailsOpen: boolean; onToggleDetails: () => void;
  onHeader: (key: HeaderKey, value: string) => void; readOnly: boolean;
}) {
  return <>
    <div className="ow-sheet-toolbar">
      <h3>Market order</h3>
      <button className="ow-link ow-sheet-order-details" type="button" aria-expanded={detailsOpen}
        aria-controls="ow-spreadsheet-header-fields" onClick={onToggleDetails}>Order details</button>
    </div>
    <div className="ow-sheet-header-fields" id="ow-spreadsheet-header-fields" hidden={!detailsOpen}>{sheetHeaders.map(key => <div key={key}>
      <strong>{headerLabels[key]}</strong>
      <PaperValue spreadsheet fieldKey={'header:'+key} label={headerLabels[key]} value={document[key]} readOnly={readOnly}
        changed={document[key] !== baseline[key]} type={key === 'notes' ? 'multiline' : ['date', 'start', 'end'].includes(key) ? 'date' : 'text'}
        onChange={value => onHeader(key, String(value ?? ''))} />
    </div>)}</div>
  </>;
}

function OrderSpreadsheet({ lines, markets, marketIds, digital, shared, selected, onSelect, onLine, onRemove, onAdd, readOnly }: {
  lines: OrderLine[]; markets: MarketOption[]; marketIds: string[]; digital: boolean; shared: boolean;
  selected: string | null; onSelect: (id: string) => void;
  onLine: (id: string, change: Partial<OrderLine>) => void; onRemove: (id: string) => void; onAdd: () => void; readOnly: boolean;
}) {
  const name = digital ? 'Digital' : 'Broadcast';
  const columns = digital ? digitalPlacements : sheetPlacements;
  const multiMarket = marketIds.length > 1;
  const amount = lines.reduce((sum, line) => sum + (bookedAmount(line) ?? 0), 0);
  const impressions = lines.reduce((sum, line) => sum + (line.impressions ?? 0), 0);
  const spots = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  const groups = orderVendorGroups(lines.map((line, index) => ({line, index})), item => item.line);
  return <section className="ow-placement-sheet" aria-label={name + ' placements'}>
    <div className="ow-sheet-toolbar">
      <h3>{name} placements</h3>
      <span>{lines.length} {lines.length === 1 ? 'placement' : 'placements'}</span>
      {shared && <span className="ow-placement-access">{readOnly ? 'View only' : 'Editing'}</span>}
      {!readOnly && <button type="button" className="ow-link" onClick={onAdd}>+ Add row</button>}
    </div>
    <div className="ow-sheet-scroll" tabIndex={0} role="region" aria-label={'Scroll ' + name + ' placements'} onFocus={event => {
      const cell = event.target.closest<HTMLTableCellElement>('td[data-field]');
      if (cell && cell.dataset.field !== 'station') event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }}>
      <table className="ow-sheet-table ow-order-grid" aria-label={name + ' placements spreadsheet'}>
        <thead><tr>
          {columns.map(({ key, title }) => <th key={key} scope="col" data-field={key}
            className={['amount', 'quantity', 'impressions', 'calculatedCpm'].includes(key) ? 'ow-sheet-derived' : undefined}>{title}</th>)}
          <th scope="col">Channel</th>{multiMarket && <th scope="col">Market</th>}
          {!readOnly && <th scope="col" className="ow-sheet-line-action">Action</th>}
        </tr></thead>
        <tbody>{groups.map(group => <Fragment key={orderVendorLabel(group)}>
          {(group.vendor || group.rep || groups.length > 1) && <tr className="ow-vendor-divider">
            <td colSpan={columns.length + 1 + Number(multiMarket) + Number(!readOnly)}>{orderVendorLabel(group)}</td>
          </tr>}
          {group.items.map(({line, index}) => <tr key={line.id} data-target={line.id === selected}
          onClick={readOnly ? undefined : () => onSelect(line.id)} onFocus={readOnly ? undefined : () => onSelect(line.id)}>
          {columns.map(({ key, title, type, max }) => {
            const scheduled = line.spotsPerWeek != null && line.weeks != null;
            const formula = key === 'amount' && !digital || key === 'managementFee' || key === 'amountDue' || key === 'calculatedCpm' || key === 'reportedCpm'
              || key === 'quantity' && scheduled || key === 'impressions' && line.audience != null && line.quantity != null;
            const charges = orderLineCharges(line);
            const value = key === 'managementFee' ? charges.fee : key === 'amountDue' ? charges.due :
              key === 'amount' ? (digital ? charges.media : charges.due) : key === 'calculatedCpm' ? calculatedOrderCpm(line)
              : key === 'reportedCpm' ? line.reportedCpm ?? (line.reportedCpm === undefined && !line.source?.facts ? line.cpm : null) ?? null
              : line[key] ?? null;
            const numeric = type === 'money' || type === 'percent' || type === 'number' || type === 'decimal';
            return <td key={key} data-field={key} data-numeric={numeric} className={formula ? 'ow-sheet-derived' : undefined}
              title={value == null ? missingSource : undefined}>
              <PaperValue spreadsheet fieldKey={'line:'+line.id+':'+key} value={value} label={title + ', line ' + (index + 1)} type={type} max={max}
                readOnly={readOnly || formula} onChange={next => onLine(line.id, { [key]: next })} />
            </td>;
          })}
          <td>{digital || line.source || readOnly ? line.media : <select aria-label={'Channel, line ' + (index + 1)} value={line.media}
            onChange={event => onLine(line.id, { media: event.target.value as OrderLine['media'] })}>
            <option>TV</option><option>Radio</option>{line.media === 'Digital' && <option>Digital</option>}
          </select>}</td>
          {multiMarket && <td>{line.source || readOnly ? markets.find(market => market.id === line.marketId)?.name ?? line.marketId
            : <select aria-label={'Market, line ' + (index + 1)} value={line.marketId}
              onChange={event => onLine(line.id, { marketId: event.target.value })}>
              {marketIds.map(id => <option key={id} value={id}>{markets.find(market => market.id === id)?.name ?? id}</option>)}
            </select>}</td>}
          {!readOnly && <td className="ow-sheet-line-action"><button type="button" className="ow-link ow-remove-line"
            aria-label={'Remove line ' + (index + 1)} onClick={event => { event.stopPropagation(); onRemove(line.id); }}>Remove</button></td>}
        </tr>)}</Fragment>)}</tbody>
      </table>
      {!lines.length && <p className="ow-empty">{readOnly ? 'No ' + name + ' placements.' : 'Add a row or select a research quote.'}</p>}
    </div>
    <div className="ow-sheet-totals">
      <span>{digital ? 'Digital amount due' : 'Broadcast amount due'} <strong>{valueLabel(amount, 'money')}</strong></span>
      {!digital && <span>{quantity.format(spots)} spots</span>}
      <span>{quantity.format(impressions)} imps</span>
      {impressions > 0 && lines.every(line => line.impressions != null && bookedAmount(line) != null) &&
        <span>{valueLabel(Math.round(amount * 1000 / impressions), 'money')} CPM</span>}
    </div>
  </section>;
}

function bookedAmount(line: OrderLine) {
  return orderLineCharges(line).due;
}

const missingSource='Not provided in source';
function sourceMetric(value:number|null|undefined,money=false) {
  return value==null ? <span className="ow-missing-data">{missingSource}</span> : valueLabel(value,money?'money':'number');
}
function SourceFacts({line}:{line:OrderLine}) {
  const facts=line.source?.facts;
  return facts?.length ? <dl className="ow-source-facts">{facts.map((fact,index)=>{
    const value=fact.value===null || fact.value==='' ? fact.raw?.trim() || missingSource :
      typeof fact.value==='number' ? fact.unit==='USD' ? usd.format(fact.value) : quantity.format(fact.value) : fact.value;
    const exact=typeof fact.value==='number' && Number(String(value).replace(/[$,]/g,''))!==fact.value;
    return <div key={index}><dt>{fact.label}{fact.derived && <small>Calculated</small>}</dt><dd>
      <span>{value}</span>{fact.unit && fact.unit!=='USD' && <small>{fact.unit}</small>}
      {exact && <small>Exact value: {String(fact.value)}</small>}
      {fact.raw && fact.raw!==String(value) && <small>Source text: {fact.raw}</small>}
      {fact.locator && <small>{fact.locator}</small>}
    </dd></div>;
  })}</dl> : <p className="ow-missing-data">{missingSource}</p>;
}

function OrderPaper({ document, baseline, markets, marketIds, workflow, editingDigital, selected, onSelect, onHeader, onLine, onRemove, onAdd, readOnly }: {
  document: OrderDocument; baseline: OrderDocument; markets: MarketOption[]; marketIds: string[]; workflow: OrderWorkflow; editingDigital?: boolean;
  selected: string | null; onSelect: (id: string) => void; onHeader: (key: HeaderKey, value: string) => void;
  onLine: (id: string, change: Partial<OrderLine>) => void; onRemove: (id: string) => void;
  onAdd: (media: OrderLine['media']) => void; readOnly: boolean;
}) {
  const marketName = (id: string) => markets.find(item => item.id === id)?.name ?? id;
  const sections = editingDigital !== undefined ? [false, true] : workflow === 'digital' ? [true] : document.lines.some(item => item.media === 'Digital') ? [false, true] : [false];

  function header(key: HeaderKey, type?: FieldType) {
    return <PaperValue fieldKey={'header:'+key} value={document[key]} type={type} label={headerLabels[key]} readOnly={readOnly}
      changed={document[key] !== baseline[key]} onChange={value => onHeader(key, String(value ?? ''))} />;
  }

  const placementReadOnly = (digital: boolean) => readOnly || (editingDigital !== undefined && editingDigital !== digital);

  function field(line: OrderLine, key: LineKey, index: number, type?: FieldType, missing?:string) {
    return <PaperValue fieldKey={'line:'+line.id+':'+key} value={line[key] ?? null} type={type} label={lineLabels[key] + ', line ' + (index + 1)} readOnly={placementReadOnly(line.media === 'Digital')} max={key==='feeBasisPoints'?100:undefined}
      missing={missing} changed={line[key] !== baseline.lines.find(item => line.id === item.id)?.[key]} onChange={value => onLine(line.id, { [key]: value })} />;
  }

  return <article className="ow-paper" aria-label="Media Order">
    <div className="ow-paper-stripe" aria-hidden="true" />
    <img className="ow-paper-logo" src="/brand/media-order-logo.png" width="180" height="42" alt="Final Fore Media" />
    <h3>Media Order</h3>
    <dl className="ow-paper-head">
      <div><dt>Order Date</dt><dd>{header('date', 'date')}</dd></div>
      <div><dt>Media Vendor</dt><dd>{header('vendor')}{header('rep')}</dd></div>
      <div><dt>Order No.</dt><dd>{header('number')}</dd></div>
      <div><dt>Terms</dt><dd>{header('terms')}</dd></div>
      <div><dt>Client</dt><dd>{header('clientName')}</dd></div>
      <div><dt>Buyer Contact</dt><dd>{header('buyer')}{header('buyerEmail')}</dd></div>
      <div><dt>Billing Contact</dt><dd>{header('billing')}</dd></div>
    </dl>
    <div className="ow-paper-flight">
      <div><strong>Flight start</strong>{header('start', 'date')}</div>
      <div><strong>Flight end</strong>{header('end', 'date')}</div>
    </div>
    {sections.map(digital => {
      const sectionReadOnly = placementReadOnly(digital);
      const columnCount=(digital?10:11)+(marketIds.length>1?1:0)+3;
      const lines = document.lines.map((line, index) => ({ line, index })).filter(({ line }) => (line.media === 'Digital') === digital);
      const total = lines.reduce((sum, { line }) => sum + (bookedAmount(line) ?? 0), 0);
      const groups = orderVendorGroups(lines, item => item.line);
      return <section className="ow-schedule" key={String(digital)} aria-label={digital ? 'Digital schedule' : 'Broadcast schedule'}>
        <h4>{digital ? 'Digital ads' : 'Broadcast ads'}</h4>
        {editingDigital !== undefined && <p className="ow-placement-access">{sectionReadOnly ? 'View only' : 'Editing'}</p>}
        <div className="ow-table-viewport">
          <table role="table" aria-label={digital ? 'Digital placements' : 'Broadcast placements'} className="ow-paper-lines">
            <thead role="rowgroup"><tr role="row"><th scope="col">Channel</th>{marketIds.length > 1 && <th scope="col">Market</th>}
              {!digital && <th scope="col">Station</th>}<th scope="col">Placement / program</th>
              <th scope="col">Format</th><th scope="col">Run days</th><th scope="col">Flight</th>
              {!digital && <><th scope="col">Rate</th><th scope="col">Spots</th></>}
              <th scope="col">{digital ? 'Media amount' : 'Amount'}</th>
              {digital && <><th scope="col">Fee %</th><th scope="col">Amount due</th></>}
              <th scope="col">Impressions</th><th scope="col">Audience</th>
              <th scope="col">Reported CPM</th><th scope="col">Calculated CPM</th><th scope="col"><span className="ow-sr-only">Line actions</span></th></tr></thead>
            <tbody role="rowgroup">{groups.map(group => <Fragment key={orderVendorLabel(group)}>
              {(group.vendor || group.rep || groups.length > 1) && <tr className="ow-vendor-divider">
                <td colSpan={columnCount}>{orderVendorLabel(group)}</td>
              </tr>}
              {group.items.map(({ line, index }) =>
              <tr key={line.id} role="row" className="ow-placement" data-selected={selected === line.id}
                onClick={sectionReadOnly ? undefined : () => onSelect(line.id)} onFocus={sectionReadOnly ? undefined : () => onSelect(line.id)}>
                <PlacementCell label="Channel">{!digital && !sectionReadOnly && !line.source
                  ? <select aria-label={'Media for line ' + (index + 1)} value={line.media} onChange={event => onLine(line.id, { media: event.target.value as OrderLine['media'] })}>
                    <option>TV</option><option>Radio</option>
                  </select> : line.media}</PlacementCell>
                {marketIds.length > 1 && <PlacementCell label="Market">{sectionReadOnly || line.source ? marketName(line.marketId) : <select aria-label={'Market for line ' + (index + 1)}
                  value={line.marketId} onChange={event => onLine(line.id, { marketId: event.target.value })}>
                  {marketIds.map(id => <option key={id} value={id}>{marketName(id)}</option>)}
                </select>}</PlacementCell>}
                {!digital && <PlacementCell label="Station">{field(line, 'station', index)}</PlacementCell>}
                <PlacementCell label="Placement / program">{field(line, 'program', index)}</PlacementCell>
                <PlacementCell label="Format">{field(line, 'format', index)}</PlacementCell>
                <PlacementCell label="Run days">{field(line, 'days', index)}</PlacementCell>
                <PlacementCell label="Flight">{field(line, 'start', index, 'date')}{field(line, 'end', index, 'date')}</PlacementCell>
                {!digital && <><PlacementCell label="Rate">{field(line, 'rate', index, 'money')}</PlacementCell>
                  <PlacementCell label="Spots">{field(line, 'quantity', index, 'number')}</PlacementCell></>}
                <PlacementCell label="Amount">{line.noCharge || (line.amount == null && line.rate != null && line.quantity != null)
                  ? valueLabel(bookedAmount(line), 'money') : field(line, 'amount', index, 'money')}</PlacementCell>
                {digital && <><PlacementCell label="Fee %">{field(line,'feeBasisPoints',index,'percent')}</PlacementCell>
                  <PlacementCell label="Amount due">{valueLabel(bookedAmount(line),'money')}</PlacementCell></>}
                <PlacementCell label="Impressions">{field(line, 'impressions', index, 'number')}</PlacementCell>
                <PlacementCell label="Audience">{field(line,'audience',index,'number',missingSource)}</PlacementCell>
                <PlacementCell label="Reported CPM">{line.reportedCpm===undefined && line.source?.facts===undefined && line.cpm!=null
                  ? <><small>Saved CPM</small>{sourceMetric(line.cpm,true)}</> : sourceMetric(line.reportedCpm,true)}</PlacementCell>
                <PlacementCell label="Calculated CPM">{sourceMetric(calculatedOrderCpm(line),true)}</PlacementCell>
                <PlacementCell>{!sectionReadOnly && <button className="ow-link ow-remove-line" type="button"
                  aria-label={'Remove line ' + (index + 1)} onClick={event => { event.stopPropagation(); onRemove(line.id); }}>Remove</button>}</PlacementCell>
              </tr>)}</Fragment>)}
              {!lines.length && <tr role="row"><td role="cell" colSpan={columnCount} className="ow-blank-line">{sectionReadOnly ? 'No placements' : 'Add a line or select a research quote.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {!sectionReadOnly && <div className="ow-line-actions">
          <button className="ow-link" type="button" onClick={() => onAdd(digital ? 'Digital' : lines[0]?.line.media === 'Radio' ? 'Radio' : 'TV')}>+ Add a line</button>
        </div>}
        <p className="ow-schedule-total">{digital ? 'Digital total' : 'Gross total'} <strong>{valueLabel(total, 'money')}</strong></p>
      </section>;
    })}
    <div className="ow-paper-notes"><strong>Order notes</strong>{header('notes', 'multiline')}</div>
    <footer><p>Please sign and date below.</p>
      <div className="ow-signature"><span>Signature</span><span>Date</span></div></footer>
  </article>;
}

function changeRows(event: OrderEvent) {
  const before = event.detail.before as OrderDocument | null | undefined;
  const after = event.detail.after as OrderDocument | null | undefined;
  if (!before || !after) return [];
  const rows = (Object.keys(headerLabels) as HeaderKey[]).filter(key => !same(before[key], after[key]))
    .map(key => ({ label: headerLabels[key] as string, before: valueLabel(before[key]), after: valueLabel(after[key]) }));
  const lines = new Set([...before.lines.map(line => line.id), ...after.lines.map(line => line.id)]);
  for (const id of lines) {
    const old = before.lines.find(line => line.id === id);
    const next = after.lines.find(line => line.id === id);
    if (!old || !next) {
      rows.push({ label: 'Placement', before: valueLabel(old?.program), after: valueLabel(next?.program) });
      continue;
    }
    for (const key of Object.keys(lineLabels) as LineKey[]) if (!same(old[key], next[key])) {
      const type = key === 'feeBasisPoints' ? 'percent' : key === 'rate' || key === 'amount' || key === 'cpm' ? 'money' : 'text';
      rows.push({ label: (next.program || next.station || 'Placement') + ' · ' + lineLabels[key],
        before: valueLabel(old[key], type), after: valueLabel(next[key], type) });
    }
  }
  return rows;
}

const historyNames: Record<string, string> = {
  saved: 'Draft saved', finalized: 'Order finalized', downloaded: 'PDF downloaded', sent: 'Send recorded',
  sendCorrected: 'Send record corrected', revised: 'New draft revision', restored: 'Revision restored',
};

function OrderHistory({ order, canRestore, busy, onRestore, onDownload, onClose }: {
  order: OrderDetail; canRestore: boolean; busy: boolean; onRestore: (event: OrderEvent) => void;
  onDownload: (id: string) => Promise<void>; onClose: () => void;
}) {
  return <OrdersDialog title="Edit history & activity" drawer onClose={onClose}>
    <section className="ow-history">
      {!!order.issues.length && <><h3>Finalized documents</h3><ul>{[...order.issues].reverse().map(issue => <li key={issue.id}>
        <strong>Revision {issue.revision}</strong> · {displayTime(issue.issuedAt)}
        <button type="button" className="ow-link" disabled={busy} onClick={() => void onDownload(issue.id)}>Download PDF</button>
      </li>)}</ul></>}
      <h3>Activity</h3>
      {!order.history.length && <p>Saved changes and document activity will appear here.</p>}
      <ol>{[...order.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(event => {
        const rows = changeRows(event);
        const recipient = typeof event.detail.recipient === 'string' ? event.detail.recipient : '';
        const note = typeof event.detail.note === 'string' ? event.detail.note : '';
        const sentAt = typeof event.detail.sentAt === 'string' ? event.detail.sentAt : '';
        return <li key={event.id}>
          <strong>{historyNames[event.type] ?? event.type}</strong>
          <small>Revision {event.revision} · {displayTime(event.createdAt)} · {event.actorId}</small>
          {(recipient || sentAt || note) && <p>{[recipient, sentAt && displayTime(sentAt), note].filter(Boolean).join(' · ')}</p>}
          {!!rows.length && <dl>{rows.map((row, i) => <div key={row.label + i}><dt>{row.label}</dt>
            <dd><del>{row.before}</del> <ins>{row.after}</ins></dd></div>)}</dl>}
          {canRestore && event.type === 'saved' && Boolean(event.detail.after) && <button className="ow-link" type="button"
            disabled={busy} onClick={() => onRestore(event)}>Restore this revision</button>}
        </li>;
      })}</ol>
    </section>
  </OrdersDialog>;
}

function PrintOrderDialog({ document, markets, clientOrder, onClose }: {
  document: OrderDocument; markets: MarketOption[]; clientOrder: boolean; onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [markup] = useState(() => orderPdfMarkup(document, '/brand/media-order-logo.png',
    Object.fromEntries(markets.map(market => [market.id, market.name])), true, clientOrder));
  return <OrdersDialog title="Print preview" onClose={onClose}>
    <iframe ref={frame} className="ow-print-preview" title="Draft media order" srcDoc={markup}
      sandbox="allow-same-origin allow-modals" onLoad={() => setReady(true)} />
    <button type="button" className="ow-primary" disabled={!ready} onClick={() => frame.current?.contentWindow?.print()}>
      Print order
    </button>
  </OrdersDialog>;
}

function SendDialog({ order, issue, mode, busy, mutate, onUpdate, onClose, onDownload }: {
  order: OrderDetail; issue: OrderIssue; mode: 'send' | 'correct'; busy: boolean;
  mutate: Mutate; onUpdate: (order: OrderDetail) => void; onClose: () => void;
  onDownload?: (issueId: string) => Promise<void>;
}) {
  const corrected = new Set(order.history.filter(event => event.type === 'sendCorrected').map(event => event.detail.sendEventId));
  const sent = order.history.filter(event => event.type === 'sent' && event.issueId === issue.id && !corrected.has(event.id));
  return <OrdersDialog title={mode === 'correct' ? 'Correct send record' : onDownload ? 'Send order' : 'Record send'} onClose={onClose}>
    <form className="ow-form" onSubmit={async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const common = { id: order.id, issueId: issue.id, note: String(values.get('note') ?? '') };
      const sentAt = new Date(String(values.get('sentAt') ?? ''));
      const result = await mutate<OrderDetail>(mode === 'send' ? {
        ...common, action: 'recordSend', recipient: String(values.get('recipient') ?? ''), sentAt: sentAt.toISOString(),
      } : { ...common, action: 'correctSend', sendEventId: String(values.get('sendEventId') ?? '') });
      if (result) { onUpdate(result); onClose(); }
    }}>
      {mode === 'send' ? <>
        {onDownload ? <>
          <p>Download the finalized PDF to send by email. Record the recipient and time after sending.</p>
          <button type="button" disabled={busy} onClick={() => void onDownload(issue.id)}>Download order PDF</button>
        </> : <p>Record how this finalized revision was sent.</p>}
        <label>Recipient<input required name="recipient" maxLength={254} /></label>
        <label>Sent at<input required name="sentAt" type="datetime-local" /></label>
      </> : <label>Send record<select required name="sendEventId">
        {sent.map(event => <option key={event.id} value={event.id}>
          {typeof event.detail.recipient === 'string' ? event.detail.recipient + ' · ' : ''}{displayTime(event.createdAt)}
        </option>)}</select></label>}
      <label>{mode === 'correct' ? 'Reason' : 'Note'}<textarea required={mode === 'correct'} name="note" maxLength={500} /></label>
      <button className="ow-primary" disabled={busy || mode === 'correct' && !sent.length}>{mode === 'send' ? 'Record send' : 'Save correction'}</button>
    </form>
  </OrdersDialog>;
}

function blankLine(media: OrderLine['media'], marketId: string): OrderLine {
  return {
    id: crypto.randomUUID(), media, marketId, station: '', program: '', format: '', days: '', start: '', end: '',
    notes: '', rate: null, quantity: null, amount: null, impressions: null, noCharge: false,
  };
}

export function OrderEditor({ selection, client, markets, canEdit, busy, fromCalendar, planUrl, sheet, mutate, onDirty, onBack, onCancel = onBack, onSave, onUpdate, onDownload }: OrderEditorProps) {
  const [document, setDocument] = useState(selection.document);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, showHistory] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmation, confirm] = useState<'finalize' | 'send' | 'revision' | OrderEvent | null>(null);
  const [send, setSend] = useState<'send' | 'correct' | null>(null);
  const [split, setSplit] = useState(58);
  const marketOrder = isMarketOrder(selection);
  const [section, setSection] = useState<'broadcast'|'digital'>(sheet === 'digital' ? 'digital' : 'broadcast');
  const digitalSection = selection.workflow === 'digital' || marketOrder && section === 'digital';
  const [spreadsheet, setSpreadsheet] = useState(marketOrder);
  const [sheetDetailsOpen, setSheetDetailsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  const order = selection.order;
  const issue = order?.currentIssue;
  const broadcast = selection.workflow === 'broadcast';
  const immutable = !canEdit || !!issue;
  const [applying,setApplying]=useState(false);
  const [recoveryFields,setRecoveryFields]=useState<Record<string,string>>({});
  const recovered=useRef<string|null>(null);
  const [recoveryConflict,setRecoveryConflict]=useState(false);
  const sync=useDraftSync(document,selection.document,onSave,!immutable);
  const work=useRef({document,fields:recoveryFields});work.current={document,fields:recoveryFields};
  const researchState=useOrderResearchState(order?.id,()=>sync.flush(true));
  const readOnly=immutable || !!order && !researchState.ready || researchState.viewConflict || applying;
  const dirty=researchState.saving || !!researchState.error || sync.dirty || recoveryConflict || Object.keys(recoveryFields).length>0 || researchState.status.phase==='pending' || researchState.status.phase==='saving' || researchState.status.phase==='error';
  const [editorError,setEditorError]=useState('');
  const [loadingPriorDigital, setLoadingPriorDigital] = useState(false);
  const [launching,setLaunching]=useState(false);
  const researchView=useRef<ResearchView>({sheet:sheet==='digital'?'digital':sheet==='radio'?'radio':'tv'});
  const launchContext=useRef<string|null>(null);
  const onResearchView=useCallback((value:ResearchView)=>{researchView.current=value;researchState.changeView(value);},[researchState.changeView]);
  const saveAndLeave=async(next:()=>void)=>{
    try {
      const saved=await sync.flush(!order||Object.keys(work.current.fields).length>0);
      const id=saved?.id??order?.id;
      if(immutable||recoveryConflict)await researchState.flush(id);
      else await researchState.flush(id,Object.keys(work.current.fields).length?{
        baseRevision:saved?.revision??order!.revision,document:work.current.document,fields:work.current.fields}:null);
      next();
    }
    catch(error){setEditorError(error instanceof Error?error.message:'Could not save before leaving.');}
  };
  async function askChatGPT(){
    setLaunching(true);setEditorError('');
    if(Object.keys(recoveryFields).length||recoveryConflict){setEditorError('Correct or review the recovered entries before opening ChatGPT.');setLaunching(false);return;}
    // Reserve the window during the user gesture so the later save does not trigger a popup block.
    const destination=window.open('about:blank','_blank');
    if(destination)destination.opener=null;
    try{
      const saved=await sync.flush(true);
      await researchState.flush(saved?.id??order?.id,null);
      if(!saved&&!order)throw new Error('Save this draft before opening ChatGPT.');
      const result=await assistantRequest<{contextId:string;url:string}>({action:'launch',orderId:saved?.id??order!.id,view:researchView.current});
      launchContext.current=result.contextId;
      if(destination)destination.location.replace(result.url);
      else window.location.assign(result.url);
    }catch(error){destination?.close();setEditorError(error instanceof Error?error.message:'Could not open ChatGPT.');}
    finally{setLaunching(false);}
  }
  useEffect(()=>()=>{
    const contextId=launchContext.current;
    if(contextId)void fetch('/api/order-assistant',{method:'POST',credentials:'same-origin',keepalive:true,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'detach',contextId})}).catch(()=>{});
  },[]);
  const total = document.lines.reduce((sum, line) => sum + (bookedAmount(line) ?? 0), 0);
  const canEditPlacement = (line: OrderLine) => !readOnly && (!marketOrder || (line.media === 'Digital') === digitalSection);
  const scope = selection.marketIds.map(id => markets.find(market => market.id === id)?.name ?? id);
  const changeRaw=useCallback((key:string,value:string|null)=>{
    setRecoveryFields(current=>{
      if(value===null){if(!(key in current))return current;const next={...current};delete next[key];return next;}
      return current[key]===value?current:{...current,[key]:value};
    });
  },[]);
  useEffect(()=>{
    const state=researchState.state;
    if(!state||!order||!researchState.ready||recovered.current===order.id)return;
    recovered.current=order.id;
    if(!state.recovery)return;
    if(immutable){setRecoveryConflict(true);return;}
    if(state.recovery.baseRevision===order.revision){setDocument(state.recovery.document);setRecoveryFields(state.recovery.fields);}
    else setRecoveryConflict(true);
  },[researchState.state,order,researchState.ready,immutable]);
  useEffect(()=>{
    if(immutable||!researchState.ready||researchState.viewConflict||applying)return;
    if(Object.keys(recoveryFields).length&&!order)void sync.flush(true).catch(()=>{});
    if(order&&recovered.current===order.id&&!recoveryConflict)researchState.changeRecovery(
      Object.keys(recoveryFields).length||sync.dirty?{baseRevision:order.revision,document,fields:recoveryFields}:null);
  },[document,recoveryFields,order?.id,order?.revision,sync.dirty,immutable,researchState.ready,researchState.viewConflict,applying,researchState.changeRecovery,recoveryConflict]);
  const sourceLine = document.lines.find(line => line.id === selected) ?? document.lines.find(line => line.source?.facts?.length);
  const source = (order?.seed ?? selection.seed) as { id?: string; title?: string; url?: string; orderNumber?: string; year?: number;
    related?: { id: string; title?: string; url?: string }[]; billing?: BillingReference | null } | null | undefined;
  const hasLineSource = !!sourceLine?.source?.facts?.length;
  const priorDigitalYear = marketOrder && digitalSection && order && !readOnly &&
    !document.lines.some(line => line.media === 'Digital') ? source?.year : undefined;

  async function usePriorDigital() {
    if (!priorDigitalYear || busy || loadingPriorDigital) return;
    setLoadingPriorDigital(true);
    setEditorError('');
    try {
      const template = await fetch(ordersUrl({
        view: 'seed', clientId: selection.clientId, year: selection.year,
        marketId: selection.marketIds[0], workflow: selection.workflow,
      }), { cache: 'no-store' }).then(ordersJson<OpenOrder>);
      const lines = template.document.lines.filter(line => line.media === 'Digital' && line.source?.year === priorDigitalYear);
      if (!lines.length) throw new Error('No prior Digital placements were found for this market.');
      setDocument(current => current.lines.some(line => line.media === 'Digital')
        ? current : { ...current, lines: [...current.lines, ...lines] });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Could not load prior Digital placements.');
    } finally {
      setLoadingPriorDigital(false);
    }
  }

  const leave=useRef(saveAndLeave);leave.current=saveAndLeave;
  const unsaved=useRef(dirty);unsaved.current=dirty;
  useEffect(()=>{
    let resubmitting=false;
    const click=(event:MouseEvent)=>{
      const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
      if(!anchor||!unsaved.current||event.button!==0||event.metaKey||event.ctrlKey||anchor.target==='_blank'||anchor.download)return;
      const url=new URL(anchor.href,window.location.href);
      if(url.origin!==window.location.origin||url.href===window.location.href||anchor.getAttribute('href')?.startsWith('#'))return;
      event.preventDefault();event.stopPropagation();void leave.current(()=>window.location.assign(url.href));
    };
    const submit=(event:SubmitEvent)=>{
      const form=event.target;
      if(resubmitting||!unsaved.current||!(form instanceof HTMLFormElement)||new URL(form.action,window.location.href).pathname!=='/logout')return;
      event.preventDefault();void leave.current(()=>{resubmitting=true;form.requestSubmit();});
    };
    const hidden=()=>{if(window.document.visibilityState==='hidden'&&unsaved.current)void leave.current(()=>{});};
    window.document.addEventListener('click',click,true);window.document.addEventListener('submit',submit,true);
    window.document.addEventListener('visibilitychange',hidden);
    return ()=>{window.document.removeEventListener('click',click,true);window.document.removeEventListener('submit',submit,true);window.document.removeEventListener('visibilitychange',hidden);};
  },[]);
  const latestEditor=useRef({dirty,busy,order,onUpdate,researchState});
  latestEditor.current={dirty,busy,order,onUpdate,researchState};
  useEffect(()=>{
    if(!order?.id)return;
    let active=true;
    const read=async()=>{
      const state=latestEditor.current;
      if(state.busy||!state.researchState.ready)return;
      try{
        const response=await fetch('/api/orders?view=order&id='+order.id,{cache:'no-store'});
        if(!response.ok)return;
        const saved=await response.json() as OrderDetail;
        if(!active||latestEditor.current.busy)return;
        const latest=latestEditor.current,previous=latest.order;
        if(!previous||saved.revision<previous.revision)return;
        if(saved.revision===previous.revision&&saved.currentIssue&&!previous.currentIssue){
          await latest.researchState.flush(previous.id,{baseRevision:previous.revision,document:work.current.document,fields:work.current.fields});
          setRecoveryFields({});latest.onUpdate(saved);return;
        }
        if(latest.dirty||latest.researchState.saving||latest.researchState.status.phase!=='saved')return;
        if(saved.revision>previous.revision)latest.onUpdate(saved);
        await latest.researchState.reload();
      }catch{/* Keep the existing acknowledged draft and save error state. */}
    };
    const focus=()=>void read();
    const timer=setInterval(()=>{if(window.document.visibilityState==='visible')void read();},5000);
    window.addEventListener('focus',focus);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[order?.id]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { setDocument(selection.document); }, [selection.document]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  function updateLine(id: string, patch: Partial<OrderLine>) {
    setDocument(current=>({...current,lines:current.lines.map(line=>{
      if(line.id!==id||!canEditPlacement(line))return line;
      const changes = spreadsheetScheduleChanges(line, patch);
      const next={...line,...changes,
        ...(changes.amount===undefined && ('rate' in changes || 'quantity' in changes) && line.media!=='Digital' ? {amount:null}: {})};
      return {...next,calculatedCpm:calculatedOrderCpm(next)};
    })}));
  }

  function add(media: OrderLine['media']) {
    const line = blankLine(digitalSection ? 'Digital' : media === 'TV' && sheet === 'radio' ? 'Radio' : media, selection.marketIds[0]);
    setDocument(current => ({ ...current, lines: [...current.lines, line] }));
    setSelected(line.id);
  }

  function removeLine(id: string) {
    const line = document.lines.find(item => item.id === id);
    if (!line || !canEditPlacement(line)) return;
    setRecoveryFields(current=>Object.fromEntries(Object.entries(current).filter(([key])=>!key.startsWith('line:'+id+':'))));
    setDocument(current => ({ ...current, lines: current.lines.filter(line => line.id !== id) }));
    setSelected(current => current === id ? null : current);
  }

  function apply(quote: OrderLine, replace: boolean) {
    if (readOnly || !selection.marketIds.includes(quote.marketId) ||
      (quote.media === 'Digital') !== digitalSection) return;
    const target = document.lines.find(line => line.id === selected);
    if (replace && (!target || quote.marketId !== target.marketId || quote.media !== target.media)) return;
    if (replace && target) {
      setDocument(current=>({...current,lines:current.lines.map(line=>line.id===target.id?replaceResearchLine(line,quote):line)}));
      return;
    }
    const line = { ...quote, id: crypto.randomUUID() };
    setDocument(current => ({ ...current, lines: [...current.lines, line] }));
    setSelected(line.id);
  }

  async function action() {
    if (!order || !confirmation) return;
    const input = typeof confirmation === 'object' ? { action: 'restoreRevision', eventId: confirmation.id }
      : { action: confirmation === 'revision' ? 'createRevision' : 'finalizeOrder' };
    const result = await mutate<OrderDetail>({ ...input, id: order.id, expectedRevision: order.revision });
    if (result) {
      onUpdate(result);
      confirm(null);
      if (confirmation === 'send') setSend('send');
    }
  }

  const headerChange = (key: HeaderKey, value: string) => setDocument(current => ({ ...current, [key]: value }));
  const orderPane = spreadsheet
    ? <section className="ow-order-sheet" key="order" aria-label="Order spreadsheet">
      <OrderSpreadsheetDetails document={document} baseline={selection.document} readOnly={readOnly}
        onHeader={headerChange} detailsOpen={sheetDetailsOpen} onToggleDetails={() => setSheetDetailsOpen(open => !open)} />
      <div className="ow-placement-sheets">
        {(marketOrder ? [false, true] : [digitalSection]).map(digital => {
          const lines = marketOrder ? document.lines.filter(line => (line.media === 'Digital') === digital) : document.lines;
          return <OrderSpreadsheet key={String(digital)} digital={digital} shared={marketOrder} lines={lines}
            markets={markets} marketIds={selection.marketIds} selected={selected} onSelect={setSelected}
            onLine={updateLine} onRemove={removeLine} readOnly={readOnly || (marketOrder && digital !== digitalSection)}
            onAdd={() => add(lines.find(line => line.id === selected)?.media ?? lines[0]?.media ?? 'TV')} />;
        })}
      </div>
    </section>
    : <div className="ow-paper-pane" key="order">
      <OrderPaper document={document} editingDigital={marketOrder ? digitalSection : undefined} baseline={selection.document} markets={markets} marketIds={selection.marketIds}
        workflow={selection.workflow} selected={selected} onSelect={setSelected} onHeader={headerChange}
        onLine={updateLine} onRemove={removeLine} onAdd={add} readOnly={readOnly} />
    </div>;
  const divider = researchOpen && <div key="divider" className="ow-panel-divider" role="separator" tabIndex={0}
    aria-label="Resize order and research panels" aria-orientation="vertical" aria-valuemin={35} aria-valuemax={72} aria-valuenow={split}
    onPointerDown={event => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || !panels.current) return;
      const bounds = panels.current.getBoundingClientRect();
      const left = Math.round(100 * (event.clientX - bounds.left) / bounds.width);
      setSplit(Math.min(72, Math.max(35, spreadsheet ? 100 - left : left)));
    }} onKeyDown={event => {
      const step = spreadsheet ? -2 : 2;
      const next = { ArrowLeft: split - step, ArrowRight: split + step, Home: 35, End: 72 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); setSplit(Math.min(72, Math.max(35, next)));
    }} />;
  const researchPane = <OrderResearch key={'research:' + section} section={marketOrder ? section : undefined} client={client} markets={markets} marketIds={selection.marketIds} workflow={selection.workflow}
    year={selection.year} initialSheet={digitalSection ? 'digital' : sheet === 'radio' ? 'radio' : 'tv'} document={document} target={selected} onApply={apply} onRemove={removeLine}
    canEdit={!readOnly} spreadsheet={spreadsheet} hidden={!researchOpen}
    persistedState={researchState.state} shortlistBusy={researchState.saving}
    onStar={researchState.star} onView={onResearchView}
    orderLineSource={hasLineSource || source?.id || source?.billing ? <details className="ow-order-line-source">
      <summary>{hasLineSource ? 'Order line source' : 'Order sources'}</summary>
      {sourceLine && hasLineSource && <>
        <p>{sourceLine.station || sourceLine.media} · {sourceLine.program}</p>
        <SourceFacts line={sourceLine} />
      </>}
      {source?.id && <div className="ow-bar ow-order-original"><strong>Signed source</strong>
        <Source source={{ id: source.id, title: source.title, url: source.url, locator: source.orderNumber }} />
        {source.related?.map(item => <Source key={item.id} source={item} />)}
      </div>}
      {source?.billing && <PriorBilling reference={source.billing} />}
    </details> : undefined} />;

  return <FieldRecovery.Provider value={{fields:immutable?{}:recoveryFields,change:changeRaw}}><section className="ow-editor" aria-label="Order editor">
    <div className="ow-bar ow-compact ow-editor-head">
      {planUrl ? <a href={planUrl} className="ow-link" onClick={event => {
        if (dirty || busy) { event.preventDefault(); void saveAndLeave(onBack); }
      }}>‹ Back to campaign plan</a> : <button type="button" className="ow-link" onClick={()=>void saveAndLeave(onBack)}>
        ‹ {fromCalendar ? 'Back to calendar' : 'Back to orders'}
      </button>}
      <h2 ref={heading} tabIndex={-1}>{document.number || (marketOrder ? 'Market order' : selection.workflow === 'digital' ? 'Digital order' : 'Broadcast order')}</h2>
      <span className="ow-pill">{issue ? 'Finalized' : 'Draft'}</span>
      {order?.downloaded && <span className="ow-pill">PDF downloaded</span>}
      {order?.sent && <span className="ow-pill">Sent</span>}
      <strong>Total due {valueLabel(total, 'money')}</strong>
      {selection.marketProposed===null && <span>Missing budget</span>}
      {selection.marketProposed!=null && <>
        <span>Proposed <b>{valueLabel(selection.marketProposed,'money')}</b></span>
        <span>Difference <b>{valueLabel(selection.marketProposed-total,'money')}</b></span>
      </>}
      {order && <button className="ow-link" type="button" onClick={() => showHistory(true)}>Edit history &amp; activity</button>}
    </div>
    <div className="ow-bar ow-compact ow-editor-tools">
      <span>{selection.year} · {client.name} · {scope.join(', ')}</span>
      {marketOrder && <div className="ow-order-views" role="group" aria-label="Placement section">
        {(['broadcast','digital'] as const).map(tab => <button type="button" key={tab} aria-pressed={section===tab}
          onClick={() => { if (tab!==section) {setSelected(null);setSection(tab);} }}>{tab==='broadcast'?'Broadcast':'Digital'}</button>)}
      </div>}
      {priorDigitalYear && <button type="button" className="ow-link" disabled={busy || loadingPriorDigital}
        onClick={() => void usePriorDigital()}>{loadingPriorDigital ? 'Loading prior placements…' : `Use ${priorDigitalYear} Digital placements`}</button>}
      {selection.workflow === 'broadcast' && <div className="ow-order-views" role="group" aria-label="Order view">
        <button type="button" aria-pressed={!spreadsheet} onClick={() => setSpreadsheet(false)}>Order view</button>
        <button type="button" aria-pressed={spreadsheet} onClick={() => setSpreadsheet(true)}>Spreadsheet view</button>
      </div>}
      {selection.workflow==='broadcast' && <button type="button" className="ow-link" disabled={launching||applying||!researchState.ready||researchState.viewConflict||selection.marketIds.length!==1}
        onClick={()=>void askChatGPT()}>{launching?'Opening ChatGPT…':'Ask ChatGPT ↗'}</button>}
      <button type="button" className="ow-link" aria-pressed={researchOpen} onClick={() => setResearchOpen(!researchOpen)}>{researchOpen ? 'Hide research' : 'Show research'}</button>
      {broadcast && (issue && order
        ? <a className="ow-link" href={ordersUrl({view: 'issued-pdf', id: order.id, issueId: issue.id})}
            target="_blank" rel="noopener">Print order ↗</a>
        : <button type="button" className="ow-link" onClick={() => setPrinting(true)}>Print order</button>)}
      {issue && <>
        <button type="button" className="ow-primary" disabled={busy} onClick={() => void onDownload(issue.id)}>Download order PDF</button>
        {canEdit && <button type="button" disabled={busy} onClick={() => setSend('send')}>{broadcast ? 'Send order' : 'Record send'}</button>}
        {canEdit && order.sent && <button type="button" disabled={busy} onClick={() => setSend('correct')}>Correct send record</button>}
        {canEdit && <button type="button" disabled={busy} onClick={() => confirm('revision')}>Create revision</button>}
      </>}
      {order && canEdit && !issue && <>
        {broadcast && <button type="button" className="ow-link" disabled={busy || dirty || readOnly}
          onClick={() => confirm('send')}>Send order</button>}
        <button type="button" className="ow-primary" disabled={busy || dirty || readOnly}
          onClick={() => confirm('finalize')}>Finalize order</button>
      </>}
    </div>
    {researchState.viewConflict&&<div className="ow-feedback" role="alert">Saved work changed in another window. This window has been kept for review.
      <button type="button" onClick={async()=>{const saved=await researchState.useSavedWork();
        if(saved){recovered.current=null;setRecoveryFields({});setDocument(order!.document);setRecoveryConflict(false);}}}>Use saved work from the other window</button>
    </div>}
    {recoveryConflict && <div className="ow-feedback" role="alert">This order changed after incomplete entries were saved.
      <details><summary>Review recovered entries</summary>{Object.entries(researchState.state?.recovery?.fields??{}).map(([key,value])=>{
        const [kind,id,field]=key.split(':');
        const label=kind==='header'?headerLabels[id as HeaderKey]??'Order field':
          (document.lines.find(line=>line.id===id)?.program??'Placement')+' · '+(lineLabels[field as LineKey]??'Field');
        return <p key={key}>{label}: {value}</p>;
      })}</details>
      {!immutable&&<button type="button" onClick={async()=>{try{
        await researchState.flush(order?.id,null);setRecoveryFields({});setRecoveryConflict(false);
      }catch(error){setEditorError(error instanceof Error?error.message:'Could not resolve recovery.');}}}>Keep the current saved order and clear recovered entries</button>}
    </div>}
    {(editorError||researchState.error||researchState.status.error) && <p className="ow-feedback" role="alert">
      {editorError||researchState.error||researchState.status.error}
      {researchState.error&&<button type="button" onClick={()=>void researchState.retryStar().catch(()=>{})}>Retry shortlist</button>} <button type="button" onClick={()=>void researchState.reload()}>Reload research</button></p>}
    <div ref={panels} className={'ow-split' + (researchOpen ? '' : ' ow-split-alone') + (spreadsheet ? ' ow-split-spreadsheet' : '')}
      style={{ '--ow-split': split + '%' } as React.CSSProperties}>
      {spreadsheet ? [researchPane, divider, orderPane] : [orderPane, divider, researchPane]}
    </div>
    {!immutable&&researchState.ready&&<OrderAssistantChanges onBusy={setApplying} orderId={order?.id} beforeApply={async()=>{
      if(Object.keys(recoveryFields).length||recoveryConflict)throw new Error('Correct incomplete entries before applying changes.');
      const saved=await sync.flush();await researchState.flush(saved?.id??order?.id,null);
    }} onUpdate={onUpdate}/>}
    {!immutable && <div className="ow-bar ow-draft-footer">
      <strong role="status">{!order ? 'New draft — save to keep this order' : !researchState.ready ? 'Opening saved work…' : recoveryConflict ? 'Review recovered entries' : sync.status.phase==='error' ? sync.status.error :
        sync.status.phase==='saving'||sync.status.phase==='pending' ? 'Saving draft…' : Object.keys(recoveryFields).length ? (researchState.status.phase==='saved'?'Incomplete entries saved for recovery':'Saving incomplete entries…') : dirty ? 'Saving research…' : 'Draft saved'}</strong>
      <button type="button" className="ow-primary" disabled={busy || applying || !!order&&!researchState.ready || !dirty && !!order}
        onClick={()=>void saveAndLeave(()=>{})}>{sync.status.phase==='error'?'Retry save':'Save now'}</button>
      <button type="button" disabled={busy||applying} onClick={()=>void saveAndLeave(onCancel)}>Close</button>
    </div>}
    {history && order && <OrderHistory order={order} canRestore={canEdit && !issue && !dirty} busy={busy}
      onRestore={event => { showHistory(false); confirm(event); }} onDownload={onDownload} onClose={() => showHistory(false)} />}
    {printing && !issue && <PrintOrderDialog document={document} clientOrder={marketOrder}
      markets={markets} onClose={() => setPrinting(false)} />}
    {send && order && issue && <SendDialog mode={send} issue={issue} order={order} busy={busy}
      mutate={mutate} onUpdate={onUpdate} onClose={() => setSend(null)}
      onDownload={broadcast && send === 'send' ? onDownload : undefined} />}
    {confirmation && <OrdersDialog title={confirmation === 'send' ? 'Send order' : confirmation === 'finalize' ? 'Finalize order'
      : confirmation === 'revision' ? 'Create revision' : 'Restore revision'} onClose={() => confirm(null)}>
      <div className="ow-form">
        <p>{confirmation === 'send' ? 'Finalize this draft to create the PDF for sending.'
          : confirmation === 'finalize' ? 'Create the downloadable PDF from this saved revision.'
          : confirmation === 'revision' ? 'Open a new draft. This finalized PDF remains in the order’s history.'
          : 'Copy the selected saved revision into a new draft revision.'}</p>
        <button type="button" className="ow-primary" disabled={busy} onClick={() => void action()}>
          {confirmation === 'send' ? 'Finalize and continue' : confirmation === 'finalize' ? 'Finalize order'
            : confirmation === 'revision' ? 'Create revision' : 'Restore revision'}
        </button>
      </div>
    </OrdersDialog>}
  </section></FieldRecovery.Provider>;
}
