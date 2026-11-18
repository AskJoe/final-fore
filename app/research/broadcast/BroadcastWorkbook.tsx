'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { filePreviewKind } from '@/lib/research/file-preview';
import { cellText, currency, defaultQuery, measurementValue, radioFields, type Entry, type ViewQuery, type WorkbookView } from '@/lib/broadcast/view';
import { calculateRadioCpm, radioCpmFormula, isSheetName, sheetLabels, type CellValue, type MarketIssue, type MarketOption,
  type SavedMarket, type SheetName, type SourceFile } from '@/lib/broadcast/workbook';
import FilePreviewDrawer from '../_components/FilePreviewDrawer';
import FilterRibbon, { readFilters, rememberFilters, type Filters } from './FilterRibbon';
import GroupControl, { readGrouping, rememberGrouping, type Grouping } from './GroupControl';
import { saveBroadcastMarket } from './actions';

const number = new Intl.NumberFormat('en-US');
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const sidebarKey = 'final-fore:broadcast-research:sidebar';
const columnsBeforeMetrics = [
  { label: 'Market', width: 132 }, { label: 'Client', width: 68 },
  { label: 'Rep', width: 116 }, { label: 'Firm', width: 102 },
];
const sourceColumn = { label: 'Source file', width: 355 };
const reviewColumn = { label: 'Market review', width: 168 };

function columnLetter(index: number): string {
  const suffix = String.fromCharCode(65 + index % 26);
  return index < 26 ? suffix : columnLetter(Math.floor(index / 26) - 1) + suffix;
}

function ResearchCell({ cell, monthStart }: { cell: CellValue; monthStart?: boolean }) {
  if (cell === null || typeof cell !== 'object') return <td data-month-start={monthStart || undefined}>{cell}</td>;
  const source = cell.locator + ' · Source value ' + cell.raw;
  return <td className={cell.value === null ? 'broadcast-number broadcast-unavailable-value' : 'broadcast-number'}
    data-source-cell={cell.locator} data-month-start={monthStart || undefined} title={source}>{cellText(cell)}</td>;
}

function RadioCpmCell({ rate, aqh }: { rate: number | null; aqh: number | null }) {
  const cpm = calculateRadioCpm(rate, aqh);
  const title = cpm !== null ? radioCpmFormula
    : rate === null ? 'Spot rate missing' : 'CPM requires a valid spot rate and positive AQH';
  return <td className={cpm === null ? 'broadcast-number broadcast-unavailable-value' : 'broadcast-number'}
    title={title}>{cpm === null ? '—' : currency.format(cpm)}</td>;
}

function SourceControl({ file, onOpen }: { file: SourceFile; onOpen: (file: SourceFile) => void }) {
  return filePreviewKind(file.name)
    ? <button type="button" className="broadcast-link" onClick={() => onOpen(file)}>{file.name}</button>
    : <a href={'/api/research/files/download?id=' + encodeURIComponent(file.id)}>{file.name}</a>;
}

function SourceCell({ entry, onOpen, onSubmissions }: {
  entry: Entry; onOpen: (file: SourceFile) => void; onSubmissions: (files: SourceFile[]) => void;
}) {
  const { row, files } = entry;
  return <td className="broadcast-source-cell" title={row.locator}>
    {files[0] && <SourceControl file={files[0]} onOpen={onOpen} />}
    {files.length > 1 && <button type="button" className="broadcast-link broadcast-related"
      onClick={() => onSubmissions(files)}>{files.length} {row.sourceKeys.length > 1 ? 'sources' : 'submissions'}</button>}
  </td>;
}

function ReviewDialog({ issue, current, options, onSave, onClose }: {
  issue: MarketIssue; current?: SavedMarket; options: MarketOption[];
  onSave: (value: SavedMarket) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState(issue.candidates.length ? 'confirm' : 'change');
  const [choice, setChoice] = useState(issue.candidates.length === 1 ? issue.candidates[0] : '');
  const [name, setName] = useState(issue.sourceMarket);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const suggested = options.filter(option => issue.candidates.includes(option.id));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await saveBroadcastMarket(issue.key, mode, mode === 'create' ? name : choice);
      if (result.saved) onSave(result.saved);
      else setError(result.error);
    } catch {
      setError('Unable to save the market. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={ref} className="broadcast-dialog" aria-labelledby="broadcast-review-heading"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <h2 id="broadcast-review-heading">Review market match</h2>
    <dl><div><dt>Market in original file</dt><dd>{issue.sourceMarket}</dd></div>
      {current && <div><dt>Saved market</dt><dd>{current.market_name}</dd></div>}</dl>
    <div className="broadcast-review-options">
      {suggested.length > 0 && <button type="button" aria-pressed={mode === 'confirm'} disabled={saving}
        onClick={() => { setMode('confirm'); setChoice(suggested.length === 1 ? suggested[0].id : ''); }}>Confirm match</button>}
      <button type="button" aria-pressed={mode === 'change'} disabled={saving}
        onClick={() => { setMode('change'); setChoice(current?.market_id ?? ''); }}>Change match</button>
      <button type="button" aria-pressed={mode === 'create'} disabled={saving} onClick={() => setMode('create')}>Create market</button>
    </div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {mode === 'create' ? <label>Research market name<input value={name} maxLength={120} required
        onChange={event => setName(event.target.value)} /></label>
        : <label>{mode === 'confirm' ? 'Suggested market' : 'Market'}
          <select value={choice} required onChange={event => setChoice(event.target.value)}>
            <option value="">Choose a market</option>
            {(mode === 'confirm' ? suggested : options).map(option =>
              <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>}
      {error && <p className="research-error" role="alert">{error}</p>}
      <div className="broadcast-review-options">
        <button type="submit" className="research-primary" disabled={saving}>{saving ? 'Saving…' : 'Save match'}</button>
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </dialog>;
}

function SubmissionsDialog({ files, onClose, onOpen }: {
  files: SourceFile[]; onClose: () => void; onOpen: (file: SourceFile) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="broadcast-dialog" aria-labelledby="broadcast-submissions-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="broadcast-dialog-title"><h2 id="broadcast-submissions-heading">Original submissions</h2>
      <button type="button" onClick={onClose}>Close</button></div>
    <table><thead><tr><th scope="col">Market on upload</th><th scope="col">Rep</th><th scope="col">Firm</th>
      <th scope="col">Source file</th></tr></thead>
      <tbody>{files.map(file => <tr key={file.id}><td>{file.market ?? 'Unassigned'}</td><td>{file.rep}</td>
        <td>{file.firm}</td><td><SourceControl file={file} onOpen={onOpen} /></td></tr>)}</tbody>
    </table>
  </dialog>;
}

type WorkbookProps = { name: SheetName; initialView: WorkbookView | null; reviews: SavedMarket[] };

export default function BroadcastWorkbook(props: WorkbookProps) {
  const [tab, setTab] = useState({name: props.name, fromServer: true});
  const activeLink = useRef<HTMLAnchorElement>(null);
  const focusTab = useRef(false);
  useLayoutEffect(() => {
    if (focusTab.current) activeLink.current?.focus({preventScroll: true});
    focusTab.current = false;
  }, [tab.name]);
  useEffect(() => {
    function restore() {
      const sheet = new URLSearchParams(location.search).get('sheet') ?? 'tv';
      const name = isSheetName(sheet) ? sheet : 'tv';
      setTab(previous => previous.name === name ? previous : {name, fromServer: false});
    }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function select(name: SheetName) {
    if (name === tab.name) return;
    focusTab.current = true;
    window.history.pushState(null, '', '?sheet=' + name);
    setTab({name, fromServer: false});
  }
  return <WorkbookSheet key={tab.name} name={tab.name} activeLink={activeLink} select={select} fromServer={tab.fromServer}
    initialView={tab.fromServer ? props.initialView : null} reviews={tab.fromServer ? props.reviews : []} />;
}

function WorkbookSheet({name, activeLink, select, fromServer, initialView, reviews}: WorkbookProps & {
  activeLink: React.RefObject<HTMLAnchorElement | null>; select: (name: SheetName) => void; fromServer: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saved, setSaved] = useState(() => new Map(reviews.map(review => [review.review_key, review])));
  const [issue, setIssue] = useState<MarketIssue | null>(null);
  const [preview, setPreview] = useState<SourceFile | null>(null);
  const [submissions, setSubmissions] = useState<SourceFile[] | null>(null);
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState<ViewQuery>(() => fromServer ? defaultQuery : {filters: readFilters(), grouping: readGrouping(name), page: 1});
  const [loading, setLoading] = useState(!fromServer);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (fromServer) {
      const filters = readFilters();
      const grouping = readGrouping(name);
      if (Object.values(filters).some(Boolean) || grouping.primary) setQuery({ filters, grouping, page: 1 });
    }
    try {
      const preference = localStorage.getItem(sidebarKey);
      setSidebarOpen(preference === null ? !matchMedia('(max-width: 700px)').matches : preference === 'open');
    } catch { /* The control works for this page without browser storage. */ }
  }, [name, fromServer]);

  useEffect(() => {
    if (fromServer && query === defaultQuery && refresh === 0) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ sheet: name, ...query.filters, ...query.grouping, page: String(query.page) });
    setLoading(true);
    setError('');
    async function load() {
      try {
        const response = await fetch('/api/research/broadcast?' + params, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error();
        const next = await response.json() as { view: WorkbookView | null; reviews: SavedMarket[] };
        if (!controller.signal.aborted) {
          setView(next.view);
          setSaved(new Map(next.reviews.map(item => [item.review_key, item])));
          grid.current?.scrollTo(0, 0);
        }
      } catch {
        if (!controller.signal.aborted) setError('Unable to load the selected rows.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [name, fromServer, query, refresh]);

  function toggleSidebar() {
    const open = !sidebarOpen;
    setSidebarOpen(open);
    try { localStorage.setItem(sidebarKey, open ? 'open' : 'closed'); } catch { /* Keep the page state. */ }
  }

  function closeReview() {
    setIssue(null);
    const trigger = reviewTrigger.current;
    requestAnimationFrame(() => trigger?.isConnected ? trigger.focus() : grid.current?.focus());
  }

  function changeFilters(value: Filters) {
    setQuery(current => ({ ...current, filters: value, page: 1 }));
    rememberFilters(value);
  }

  function changeGrouping(value: Grouping) {
    setQuery(current => ({ ...current, grouping: value, page: 1 }));
    rememberGrouping(name, value);
  }

  const sheet = view?.sheet;
  const isTv = name === 'tv';
  const radioColumns = sheet && radioFields(sheet, name);
  const columns = sheet ? [...columnsBeforeMetrics, ...sheet.columns, ...(isTv ? [reviewColumn] : []), sourceColumn] : [];
  const useRadioMatrix = view?.matrix;
  const periods = view?.periods ?? [];
  const matrixMetrics = ['AQH (people)', 'AQH Share', 'Cume (people)'];
  if (view?.hasRates) matrixMetrics.push('Spot rate', 'CPM');
  const radioIndices = new Map(sheet?.columns.map((column, index) => [column.label, index]));
  const matrixColumns = [
    { label: 'Station', width: 106 },
    ...periods.flatMap(() => matrixMetrics.map(label => ({ label, width: label === 'AQH Share' ? 76 : 89 }))),
    ...columnsBeforeMetrics,
    { label: 'Daypart', width: 112 }, { label: 'Audience', width: 105 }, { label: 'Coverage', width: 162 }, sourceColumn,
  ];
  const headerColumns = useRadioMatrix ? matrixColumns : columns;
  const headerGroups = useRadioMatrix ? [
    { label: '', span: 1 },
    ...periods.map(period => ({
      label: /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? monthLabel.format(new Date(period + '-01T00:00:00Z')) : period || 'Unspecified period',
      span: matrixMetrics.length,
    })),
    { label: '', span: columnsBeforeMetrics.length + 4 },
  ] : sheet?.groups && [
    { label: '', span: 1 }, { label: '', span: columnsBeforeMetrics.length - 1 }, ...sheet.groups,
    { label: '', span: isTv ? 2 : 1 },
  ];
  const marketOptions = [
    ...sheet?.markets ?? [],
    ...Array.from(new Map([...saved.values()].filter(x => x.market_id.startsWith('broadcast-'))
      .map(x => [x.market_id, { id: x.market_id, name: x.market_name }])).values()),
  ].sort((a, b) => a.name.localeCompare(b.name));

  let rowNumber = view?.offset ?? 0;
  return <section className="broadcast-workbook" data-sidebar-open={sidebarOpen}>
    <header className="broadcast-header">
      <button type="button" className="broadcast-sidebar-toggle" aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} onClick={toggleSidebar}>
        <span aria-hidden="true">☰</span>
      </button>
      <h1>Broadcast Research</h1>
    </header>
    {view && <FilterRibbon filters={query.filters} options={view.filterOptions} onChange={changeFilters}>
      <GroupControl choices={view.groupFields} grouping={query.grouping} onChange={changeGrouping} />
    </FilterRibbon>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {sheet && view ? <div aria-busy={loading} ref={grid} className="broadcast-grid" role="region" aria-label={sheetLabels[name] + ' sheet'} tabIndex={0}>
      <table>
        <colgroup><col style={{ width: 40 }} />{headerColumns.map((column, index) => <col key={index} style={{ width: column.width }} />)}</colgroup>
        <thead>
          <tr className="broadcast-letters" aria-hidden="true"><th className="broadcast-row-number" />
            {headerColumns.map((_, index) => <th className={index === 0 ? 'broadcast-market' : undefined} key={index}>{columnLetter(index)}</th>)}
          </tr>
          {headerGroups && <tr className="broadcast-groups"><th className="broadcast-row-number" />
            {headerGroups.map((group, index) => <th key={index} colSpan={group.span}
              className={index === 0 ? 'broadcast-market' : undefined}>{group.label}</th>)}
          </tr>}
          <tr className={headerGroups ? 'broadcast-column-labels broadcast-grouped' : 'broadcast-column-labels'}>
            <th className="broadcast-row-number" aria-hidden="true" />
            {headerColumns.map((column, index) => <th className={index === 0 ? 'broadcast-market' : undefined}
              key={index} scope="col" data-month-start={Boolean(useRadioMatrix && index > 0 &&
                index <= periods.length * matrixMetrics.length && (index - 1) % matrixMetrics.length === 0) || undefined}>
              {column.label}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {!view.sections.length && <tr><td colSpan={headerColumns.length + 1} className="broadcast-no-matches">No rows match these filters.</td></tr>}
          {view.sections.map((section, sectionIndex) => <Fragment key={JSON.stringify([section.primary, section.secondary])}>
            {view.primaryLabel && (!sectionIndex || section.primary !== view.sections[sectionIndex - 1].primary) &&
              <tr className="broadcast-group-row"><th colSpan={headerColumns.length + 1}><span><small>{view.primaryLabel}</small> {section.primary || '(Blank)'}</span></th></tr>}
            {view.secondaryLabel && <tr className="broadcast-group-row broadcast-subgroup-row"><th colSpan={headerColumns.length + 1}><span><small>{view.secondaryLabel}</small> {section.secondary || '(Blank)'}</span></th></tr>}
            {section.lines.map(line => {
              const index = rowNumber++;
              const entry = line[0];
              if (useRadioMatrix && radioColumns) {
                const stationAt = radioIndices.get('Station')!;
                const daypartAt = radioIndices.get('Daypart')!;
                const audienceAt = radioIndices.get('Audience')!;
                const coverageAt = radioIndices.get('Coverage')!;
              const byPeriod = new Map(line.map(item => [item.row.period ?? '', item]));
              const lead = entry;
              return <tr key={lead.row.id}>
                <td className="broadcast-row-number" aria-hidden="true">{index + 1}</td>
                <th className="broadcast-market" scope="row">{cellText(lead.row.cells[stationAt])}</th>
                {periods.flatMap(period => matrixMetrics.map((metric, metricIndex) => {
                  const row = byPeriod.get(period)?.row;
                  const key = period + '/' + metric;
                  if (!row) return <td key={key} data-month-start={metricIndex === 0 || undefined} />;
                  return metric === 'CPM'
                    ? <RadioCpmCell key={key} rate={measurementValue(row.cells[radioColumns.rate])}
                      aqh={measurementValue(row.cells[radioColumns.aqh])} />
                    : <ResearchCell key={key} monthStart={metricIndex === 0} cell={row.cells[radioIndices.get(metric)!] ?? null} />;
                }))}
                <td>{lead.market}</td><td>{lead.row.client}</td><td>{lead.rep}</td><td>{lead.firm}</td>
                <td>{cellText(lead.row.cells[daypartAt])}</td><td>{cellText(lead.row.cells[audienceAt])}</td>
                <td>{cellText(lead.row.cells[coverageAt])}</td>
                <SourceCell entry={lead} onOpen={setPreview} onSubmissions={setSubmissions} />
              </tr>;
              }
              const { row, market, rep, firm } = entry;
              const review = row.issue;
              const flagged = Boolean(row.attention || review && !saved.has(review.key));
              function reviewMarket(element: HTMLButtonElement) {
                reviewTrigger.current = element;
                setIssue(review ?? null);
              }
              return <tr key={row.id} className={flagged ? 'broadcast-flagged' : undefined}>
                <td className="broadcast-row-number" aria-hidden="true">{index + 2}</td>
                <th className="broadcast-market" scope="row">
                  {market}
                  {review && flagged && <button type="button" className="broadcast-link broadcast-market-action"
                    title={'Market in file: ' + review.sourceMarket}
                    onClick={event => reviewMarket(event.currentTarget)}>Check market</button>}
                </th>
                <td>{row.client}</td><td>{rep}</td><td>{firm}</td>
                {row.cells.map((cell, col) => radioColumns?.cpm === col
                  ? <RadioCpmCell key={col} rate={measurementValue(row.cells[radioColumns.rate])}
                    aqh={measurementValue(row.cells[radioColumns.aqh])} />
                  : <ResearchCell key={col} cell={cell} />)}
                {isTv && <td>{review && <button type="button" className="broadcast-link"
                  onClick={event => reviewMarket(event.currentTarget)}>{flagged ? review.sourceMarket : 'Edit match'}</button>}</td>}
                <SourceCell entry={entry} onOpen={setPreview} onSubmissions={setSubmissions} />
              </tr>;
          })}
          </Fragment>)}
        </tbody>
      </table>
    </div> : <p className="broadcast-no-data" role="status">{loading ? 'Loading ' + sheetLabels[name] + '…' : error ? '' : 'No research has been imported yet.'}</p>}
    <nav className="broadcast-tabs" aria-label="Workbook sheets">
      {Object.entries(sheetLabels).map(([id, label]) => <a key={id} href={'/research/broadcast?sheet=' + id}
        ref={name === id ? activeLink : undefined} aria-current={name === id ? 'page' : undefined} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (isSheetName(id)) select(id);
        }}>{label}</a>)}
    </nav>
    <div className="broadcast-count" role="status">
      {view && <span>{number.format(view.matches)}{view && view.matches !== view.total && ' of ' + number.format(view.total)}
        {useRadioMatrix ? ' source rows' : ' rows'}</span>}
      {view && view.pages > 1 && <nav aria-label="Sheet pages" className="broadcast-paging">
        <button type="button" disabled={loading || view.page <= 1} onClick={() => setQuery(q => ({ ...q, page: view.page - 1 }))}>Previous</button>
        <span>Page {view.page} of {view.pages}</span>
        <button type="button" disabled={loading || view.page >= view.pages} onClick={() => setQuery(q => ({ ...q, page: view.page + 1 }))}>Next</button>
      </nav>}
      {loading && view && <span>Loading rows…</span>}
      {radioColumns && <span>CPM = {radioCpmFormula}</span>}
      {sheet && <span>{number.format(sheet.totals.values)} values · {number.format(sheet.totals.files)} original files</span>}
    </div>
    {issue && <ReviewDialog issue={issue} current={saved.get(issue.key)} options={marketOptions} onClose={closeReview}
      onSave={entry => { setSaved(previous => new Map(previous).set(entry.review_key, entry)); setRefresh(value => value + 1); closeReview(); }} />}
    {submissions && <SubmissionsDialog files={submissions} onClose={() => setSubmissions(null)}
      onOpen={file => { setSubmissions(null); setPreview(file); }} />}
    {preview && <FilePreviewDrawer file={{ id: preview.id, name: preview.name, market: preview.market ?? 'Unassigned',
      sender: preview.rep + ' · ' + preview.firm }} onClose={() => setPreview(null)} />}
  </section>;
}
