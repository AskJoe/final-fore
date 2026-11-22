import { Fragment, useEffect, useRef, useState } from 'react';
import type { OrderDetail, OrderDocument, OrderEvent, OrderIssue, OrderLine, OrderWorkflow } from '@/lib/orders/store';
import { displayTime, OrdersDialog, type ClientOption, type MarketOption, type Mutate } from './OrderCalendar';
import { OrderResearch, PriorBilling, quantity, Source, usd, type BillingReference } from './OrdersCatalog';

export type OpenOrder = {
  document: OrderDocument; clientId: string; year: number; workflow: OrderWorkflow; marketIds: string[];
  originKey?: string; firmId?: string; repId?: string; archiveId?: string | null; seed?: unknown; order?: OrderDetail;
};

type OrderEditorProps = {
  selection: OpenOrder; client: ClientOption; markets: MarketOption[]; canEdit: boolean; busy: boolean;
  fromCalendar: boolean; sheet: string; mutate: Mutate; onDirty: (dirty: boolean) => void; onBack: () => void;
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
  spotsPerDay: 'Spots per day', spotsPerWeek: 'Spots per week', weeks: 'Weeks', audience: 'Audience', cpm: 'CPM',
} as const;
type LineKey = keyof typeof lineLabels;
type FieldType = 'text' | 'date' | 'money' | 'number' | 'multiline';

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueLabel(value: unknown, type: FieldType = 'text') {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money' && typeof value === 'number') return usd.format(value / 100);
  if (type === 'number' && typeof value === 'number') return quantity.format(value);
  return String(value);
}

function PaperValue({ value, type = 'text', label, changed, readOnly, onChange }: {
  value: string | number | null; type?: FieldType; label: string; changed?: boolean;
  readOnly: boolean; onChange: (value: string | number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const original = useRef(value);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const attrs = {
    ref: input, 'aria-label': label, defaultValue: type === 'money' && typeof value === 'number' ? value / 100 : value ?? '',
    onChange: () => {
      const current = input.current;
      if (!current?.validity.valid) return;
      const next = type === 'money' || type === 'number'
        ? (current.value === '' ? null : type === 'money' ? Math.round(Number(current.value) * 100) : Number(current.value))
        : current.value;
      if (next !== value) onChange(next);
    },
    onBlur: () => {
      const current = input.current;
      if (!current?.validity.valid) onChange(original.current);
      setEditing(false);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onChange(original.current);
        setEditing(false);
      }
      if (event.key === 'Enter' && type !== 'multiline') { event.preventDefault(); input.current?.blur(); }
    },
  };
  return readOnly ? <span>{valueLabel(value, type)}</span>
    : editing && type === 'multiline' ? <textarea {...attrs} />
    : editing ? <input {...attrs} type={type === 'date' ? 'date' : type === 'number' || type === 'money' ? 'number' : 'text'}
      min={type === 'money' || type === 'number' ? 0 : undefined} step={type === 'money' ? '0.01' : type === 'number' ? '1' : undefined} />
    : <button type="button" title={'Edit ' + label} aria-label={'Edit ' + label} onClick={() => { original.current = value; setEditing(true); }}
      className="ow-paper-value" data-changed={changed}>
      {valueLabel(value, type)}<span aria-hidden="true">✎</span>
    </button>;
}

function bookedAmount(line: OrderLine) {
  if (line.noCharge) return 0;
  return line.amount ?? (line.rate !== null && line.quantity !== null ? line.rate * line.quantity : null);
}

function OrderPaper({ document, baseline, markets, marketIds, workflow, selected, onSelect, onHeader, onLine, onRemove, onAdd, readOnly }: {
  document: OrderDocument; baseline: OrderDocument; markets: MarketOption[]; marketIds: string[]; workflow: OrderWorkflow;
  selected: string | null; onSelect: (id: string) => void; onHeader: (key: HeaderKey, value: string) => void;
  onLine: (id: string, change: Partial<OrderLine>) => void; onRemove: (id: string) => void;
  onAdd: (media: OrderLine['media']) => void; readOnly: boolean;
}) {
  const marketName = (id: string) => markets.find(item => item.id === id)?.name ?? id;
  const sections = workflow === 'digital' ? [true] : document.lines.some(item => item.media === 'Digital') ? [false, true] : [false];

  function header(key: HeaderKey, type?: FieldType) {
    return <PaperValue value={document[key]} type={type} label={headerLabels[key]} readOnly={readOnly}
      changed={document[key] !== baseline[key]} onChange={value => onHeader(key, String(value ?? ''))} />;
  }

  function field(line: OrderLine, key: LineKey, index: number, type?: FieldType) {
    return <PaperValue value={line[key] ?? null} type={type} label={lineLabels[key] + ', line ' + (index + 1)} readOnly={readOnly}
      changed={line[key] !== baseline.lines.find(item => line.id === item.id)?.[key]} onChange={value => onLine(line.id, { [key]: value })} />;
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
      const lines = document.lines.map((line, index) => ({ line, index })).filter(({ line }) => (line.media === 'Digital') === digital);
      const total = lines.reduce((sum, { line }) => sum + (bookedAmount(line) ?? 0), 0);
      return <section className="ow-schedule" key={String(digital)} aria-label={digital ? 'Digital schedule' : 'Broadcast schedule'}>
        <h4>{digital ? 'Digital ads' : 'Broadcast ads'}</h4>
        <div className="ow-table-viewport">
          <table aria-label={digital ? 'Digital placements' : 'Broadcast placements'} className="ow-paper-lines">
            <thead><tr><th scope="col">Channel</th>{marketIds.length > 1 && <th scope="col">Market</th>}
              {!digital && <th scope="col">Station</th>}<th scope="col">Placement / program</th>
              <th scope="col">Format</th><th scope="col">Run days</th><th scope="col">Flight</th>
              {!digital && <><th scope="col">Rate</th><th scope="col">Spots</th></>}
              <th scope="col">Amount</th><th scope="col">Impressions</th><th scope="col"><span className="ow-sr-only">Line actions</span></th></tr></thead>
            <tbody>{lines.map(({ line, index }) => <Fragment key={line.id}>
              <tr data-selected={selected === line.id} onFocus={() => onSelect(line.id)}>
                <td>{!digital && !readOnly && !line.source
                  ? <select aria-label={'Media for line ' + (index + 1)} value={line.media} onChange={event => onLine(line.id, { media: event.target.value as OrderLine['media'] })}>
                    <option>TV</option><option>Radio</option><option>Digital</option>
                  </select> : line.media}</td>
                {marketIds.length > 1 && <td>{readOnly || line.source ? marketName(line.marketId) : <select aria-label={'Market for line ' + (index + 1)}
                  value={line.marketId} onChange={event => onLine(line.id, { marketId: event.target.value })}>
                  {marketIds.map(id => <option key={id} value={id}>{marketName(id)}</option>)}
                </select>}</td>}
                {!digital && <td>{field(line, 'station', index)}</td>}
                <td>{field(line, 'program', index)}</td><td>{field(line, 'format', index)}</td><td>{field(line, 'days', index)}</td>
                <td>{field(line, 'start', index, 'date')}{field(line, 'end', index, 'date')}</td>
                {!digital && <><td>{field(line, 'rate', index, 'money')}</td><td>{field(line, 'quantity', index, 'number')}</td></>}
                <td>{line.noCharge ? 'No charge' : line.amount == null && line.rate != null && line.quantity != null
                  ? valueLabel(bookedAmount(line), 'money') : field(line, 'amount', index, 'money')}</td>
                <td>{field(line, 'impressions', index, 'number')}</td>
                <td>{!readOnly && <button className="ow-remove-line" type="button" title="Remove line"
                  aria-label={'Remove line ' + (index + 1)} onClick={() => onRemove(line.id)}>−</button>}</td>
              </tr>
              <tr className="ow-line-details"><td colSpan={12}>
                <details><summary>Line {index + 1} notes{line.source ? ' and source' : ''}</summary>
                  <dl className="ow-placement-fields">{(['spotsPerDay', 'spotsPerWeek', 'weeks', 'audience', 'cpm'] as const).map(key =>
                    <div key={key}><dt>{lineLabels[key]}</dt><dd>{field(line, key, index, key === 'cpm' ? 'money' : 'number')}</dd></div>)}
                    {line.priorFlight && <div><dt>Prior flight</dt><dd>{line.priorFlight}</dd></div>}
                  </dl>
                  <div>{field(line, 'notes', index, 'multiline')}</div>
                  {!readOnly && <label><input type="checkbox" checked={line.noCharge}
                    onChange={event => onLine(line.id, { noCharge: event.target.checked })} /> No charge</label>}
                  {line.source && <Source source={line.source}
                    previewContext={{ market: marketName(line.marketId), sender: 'Published research' }} />}
                  {!readOnly && <button type="button" className="ow-link" aria-pressed={selected === line.id}
                    onClick={() => onSelect(line.id)}>Select line {index + 1} to replace</button>}
                </details>
              </td></tr>
            </Fragment>)}
              {!lines.length && <tr><td colSpan={12} className="ow-blank-line">{readOnly ? 'No placements' : 'Add a line or select a research quote.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {!readOnly && <div className="ow-line-actions">
          <button className="ow-link" type="button" onClick={() => onAdd(digital ? 'Digital' : lines[0]?.line.media === 'Radio' ? 'Radio' : 'TV')}>+ Add a line</button>
        </div>}
        <p className="ow-schedule-total">{digital ? 'Digital total' : 'Gross total'} <strong>{valueLabel(total, 'money')}</strong></p>
      </section>;
    })}
    {!readOnly && workflow === 'broadcast' && sections.length === 1 && <button type="button" className="ow-link" onClick={() => onAdd('Digital')}>+ Add a digital line</button>}
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
      const type = key === 'rate' || key === 'amount' || key === 'cpm' ? 'money' : 'text';
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

function SendDialog({ order, issue, mode, busy, mutate, onUpdate, onClose }: {
  order: OrderDetail; issue: OrderIssue; mode: 'send' | 'correct'; busy: boolean;
  mutate: Mutate; onUpdate: (order: OrderDetail) => void; onClose: () => void;
}) {
  const corrected = new Set(order.history.filter(event => event.type === 'sendCorrected').map(event => event.detail.sendEventId));
  const sent = order.history.filter(event => event.type === 'sent' && event.issueId === issue.id && !corrected.has(event.id));
  return <OrdersDialog title={mode === 'send' ? 'Record send' : 'Correct send record'} onClose={onClose}>
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
        <p>Record how this finalized revision was sent.</p>
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

export function OrderEditor({ selection, client, markets, canEdit, busy, fromCalendar, sheet, mutate, onDirty, onBack, onSave, onUpdate, onDownload }: OrderEditorProps) {
  const [document, setDocument] = useState(selection.document);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, showHistory] = useState(false);
  const [confirmation, confirm] = useState<'finalize' | 'revision' | OrderEvent | null>(null);
  const [send, setSend] = useState<'send' | 'correct' | null>(null);
  const [split, setSplit] = useState(58);
  const [researchOpen, setResearchOpen] = useState(true);
  const [paperVersion, setPaperVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const order = selection.order;
  const issue = order?.currentIssue;
  const readOnly = !canEdit || !!issue;
  const dirty = !same(document, selection.document);
  const total = document.lines.reduce((sum, line) => sum + (bookedAmount(line) ?? 0), 0);
  const scope = selection.marketIds.map(id => markets.find(market => market.id === id)?.name ?? id);
  const source = (order?.seed ?? selection.seed) as { id?: string; title?: string; url?: string; orderNumber?: string;
    related?: { id: string; title?: string; url?: string }[]; billing?: BillingReference | null } | null | undefined;

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { setDocument(selection.document); }, [selection.document]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  function updateLine(id: string, changes: Partial<OrderLine>) {
    setDocument(current => ({ ...current, lines: current.lines.map(line => line.id === id ? {
      ...line, ...changes,
      ...(changes.amount === undefined && ('rate' in changes || 'quantity' in changes) && line.media !== 'Digital' ? { amount: null } : {}),
    } : line) }));
  }

  function add(media: OrderLine['media']) {
    const line = blankLine(media === 'TV' && sheet === 'radio' ? 'Radio' : media, selection.marketIds[0]);
    setDocument(current => ({ ...current, lines: [...current.lines, line] }));
    setSelected(line.id);
  }

  function apply(quote: OrderLine, replace: boolean) {
    if (readOnly || !selection.marketIds.includes(quote.marketId)) return;
    const target = document.lines.find(line => line.id === selected);
    if (replace && (!target || quote.marketId !== target.marketId)) return;
    if (replace && target) {
      updateLine(target.id, { ...quote, id: target.id, marketId: target.marketId,
        start: quote.start || target.start, end: quote.end || target.end, quantity: quote.quantity ?? target.quantity });
      return;
    }
    const line = { ...quote, id: crypto.randomUUID() };
    setDocument(current => ({ ...current, lines: [...current.lines, line] }));
    setSelected(line.id);
  }

  async function action() {
    if (!order || !confirmation) return;
    const input = typeof confirmation === 'object' ? { action: 'restoreRevision', eventId: confirmation.id }
      : { action: confirmation === 'finalize' ? 'finalizeOrder' : 'createRevision' };
    const result = await mutate<OrderDetail>({ ...input, id: order.id, expectedRevision: order.revision });
    if (result) { onUpdate(result); confirm(null); }
  }

  return <section className="ow-editor" aria-label="Order editor">
    <div className="ow-bar ow-editor-head">
      <button type="button" onClick={onBack}>‹ {fromCalendar ? 'Back to calendar' : 'Back to orders'}</button>
      <h2 ref={heading} tabIndex={-1}>{document.number || (selection.workflow === 'digital' ? 'Digital order' : 'Broadcast order')}</h2>
      <span className="ow-pill">{issue ? 'Finalized' : 'Draft'}</span>
      {order?.downloaded && <span className="ow-pill">PDF downloaded</span>}
      {order?.sent && <span className="ow-pill">Sent</span>}
      <strong>{valueLabel(total, 'money')}</strong>
      {order && <button className="ow-link" type="button" onClick={() => showHistory(true)}>Edit history &amp; activity</button>}
    </div>
    {source?.id && <div className="ow-bar ow-order-original"><strong>Signed source</strong>
      <Source source={{ id: source.id, title: source.title, url: source.url, locator: source.orderNumber }} />
      {source.related?.map(item => <Source key={item.id} source={item} />)}
    </div>}
    {source?.billing && <PriorBilling reference={source.billing} />}
    <div className="ow-bar ow-editor-tools">
      <span>{selection.year} · {client.name} · {scope.join(', ')}</span>
      <button type="button" aria-pressed={researchOpen} onClick={() => setResearchOpen(!researchOpen)}>{researchOpen ? 'Hide research' : 'Show research'}</button>
      {issue && <>
        <button type="button" className="ow-primary" disabled={busy} onClick={() => void onDownload(issue.id)}>Download order PDF</button>
        {canEdit && <button type="button" disabled={busy} onClick={() => setSend('send')}>Record send</button>}
        {canEdit && order.sent && <button type="button" disabled={busy} onClick={() => setSend('correct')}>Correct send record</button>}
        {canEdit && <button type="button" disabled={busy} onClick={() => confirm('revision')}>Create revision</button>}
      </>}
      {order && canEdit && !issue && <button type="button" className="ow-primary" disabled={busy || dirty}
        onClick={() => confirm('finalize')}>Finalize order</button>}
    </div>
    {researchOpen && <label className="ow-split-control">Order / Research width
      <input type="range" aria-label="Resize order and research panels" min="35" max="72" value={split}
        onChange={event => setSplit(event.target.valueAsNumber)} /></label>}
    <div className={'ow-split' + (researchOpen ? '' : ' ow-split-alone')} style={{ '--ow-split': split + '%' } as React.CSSProperties}>
      <div className="ow-paper-pane">
        <OrderPaper key={paperVersion} document={document} baseline={selection.document} markets={markets} marketIds={selection.marketIds}
          workflow={selection.workflow} selected={selected} onSelect={setSelected}
          onHeader={(key, value) => setDocument(current => ({ ...current, [key]: value }))}
          onLine={updateLine} onRemove={id => {
            setDocument(current => ({ ...current, lines: current.lines.filter(line => line.id !== id) }));
            if (selected === id) setSelected(null);
          }} onAdd={add} readOnly={readOnly} />
      </div>
      {researchOpen && <OrderResearch client={client} markets={markets} marketIds={selection.marketIds} workflow={selection.workflow}
        year={selection.year} initialSheet={sheet} document={document} target={selected} onApply={apply} canEdit={!readOnly} />}
    </div>
    {!readOnly && <div className="ow-bar ow-draft-footer">
      {dirty && <strong role="status">Unsaved changes</strong>}
      <button type="button" className="ow-primary" disabled={busy || !dirty && !!order}
        onClick={async () => { const saved = await onSave(document); if (saved) setDocument(saved.document); }}>Save</button>
      <button type="button" disabled={busy || !dirty} onClick={() => {
        setDocument(selection.document); setSelected(null); setPaperVersion(version => version + 1);
      }}>Cancel</button>
    </div>}
    {history && order && <OrderHistory order={order} canRestore={canEdit && !issue && !dirty} busy={busy}
      onRestore={event => { showHistory(false); confirm(event); }} onDownload={onDownload} onClose={() => showHistory(false)} />}
    {send && order && issue && <SendDialog mode={send} issue={issue} order={order} busy={busy}
      mutate={mutate} onUpdate={onUpdate} onClose={() => setSend(null)} />}
    {confirmation && <OrdersDialog title={confirmation === 'finalize' ? 'Finalize order'
      : confirmation === 'revision' ? 'Create revision' : 'Restore revision'} onClose={() => confirm(null)}>
      <div className="ow-form">
        <p>{confirmation === 'finalize' ? 'Create the downloadable PDF from this saved revision.'
          : confirmation === 'revision' ? 'Open a new draft. This finalized PDF remains in the order’s history.'
          : 'Copy the selected saved revision into a new draft revision.'}</p>
        <button type="button" className="ow-primary" disabled={busy} onClick={() => void action()}>
          {confirmation === 'finalize' ? 'Finalize order' : confirmation === 'revision' ? 'Create revision' : 'Restore revision'}
        </button>
      </div>
    </OrdersDialog>}
  </section>;
}
