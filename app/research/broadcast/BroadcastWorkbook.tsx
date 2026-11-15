'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { filePreviewKind } from '@/lib/research/file-preview';
import { groupRows, rowsByPeriod } from '@/lib/broadcast/grouping';
import { calculateRadioCpm, radioCpmFormula, sheetLabels, type CellValue, type MarketIssue, type MarketOption, type ResearchRow,
  type ResearchSheet, type SavedMarket, type SheetName, type SourceFile } from '@/lib/broadcast/workbook';
import FilePreviewDrawer from '../_components/FilePreviewDrawer';
import FilterRibbon, { emptyFilters, filterFields, readFilters, rememberFilters, type Filters } from './FilterRibbon';
import GroupControl, { noGrouping, readGrouping, rememberGrouping, type GroupChoice, type Grouping } from './GroupControl';
import { saveBroadcastMarket } from './actions';

const number = new Intl.NumberFormat('en-US');
const measurement = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const sidebarKey = 'final-fore:broadcast-research:sidebar';
const columnsBeforeMetrics = [
  { label: 'Market', width: 132 }, { label: 'Client', width: 68 },
  { label: 'Rep', width: 116 }, { label: 'Firm', width: 102 },
];
const sourceColumn = { label: 'Source file', width: 355 };
const reviewColumn = { label: 'Market review', width: 168 };

type Entry = { row: ResearchRow; market: string; files: SourceFile[]; rep: string; firm: string };
type GroupField = GroupChoice & { value: (entry: Entry) => string };

function columnLetter(index: number): string {
  const suffix = String.fromCharCode(65 + index % 26);
  return index < 26 ? suffix : columnLetter(Math.floor(index / 26) - 1) + suffix;
}

function submissionsFor(sheet: ResearchSheet, row: ResearchRow) {
  const files = row.sourceKeys.flatMap(key => sheet.sources[key]?.files ?? []);
  if (!row.sourceMarketId) return files;
  return files.toSorted((a, b) => Number(b.marketId === row.sourceMarketId) - Number(a.marketId === row.sourceMarketId));
}

function cellText(cell: CellValue) {
  if (cell === null || typeof cell !== 'object') return String(cell ?? '');
  return cell.value === null ? 'Unavailable'
    : cell.unit === 'USD' ? currency.format(cell.value)
    : measurement.format(cell.value) + (cell.unit === 'percent' ? '%' : '');
}

function ResearchCell({ cell, monthStart }: { cell: CellValue; monthStart?: boolean }) {
  if (cell === null || typeof cell !== 'object') return <td data-month-start={monthStart || undefined}>{cell}</td>;
  const source = cell.locator + ' · Source value ' + cell.raw;
  return <td className={cell.value === null ? 'broadcast-number broadcast-unavailable-value' : 'broadcast-number'}
    data-source-cell={cell.locator} data-month-start={monthStart || undefined} title={source}>{cellText(cell)}</td>;
}

function measurementValue(cell: CellValue | undefined): number | null {
  if (typeof cell === 'number') return cell;
  return typeof cell === 'object' && cell !== null ? cell.value : null;
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

function GroupBody({ entries, primary, secondary, width, renderRows }: {
  entries: Entry[]; primary?: GroupField; secondary?: GroupField; width: number; renderRows: (entries: Entry[]) => ReactNode;
}) {
  function heading(field: GroupField, label: string, subgroup = false) {
    return <tr className={subgroup ? 'broadcast-group-row broadcast-subgroup-row' : 'broadcast-group-row'}>
      <th colSpan={width}><span><small>{field.label}</small> {label || '(Blank)'}</span></th>
    </tr>;
  }
  if (!primary || entries.length === 0) return <tbody>{renderRows(entries)}</tbody>;
  return <tbody>{groupRows(entries, primary.value).map(group => <Fragment key={group.label}>
    {heading(primary, group.label)}
    {secondary ? groupRows(group.rows, secondary.value).map(subgroup => <Fragment key={subgroup.label}>
      {heading(secondary, subgroup.label, true)}
      {renderRows(subgroup.rows)}
    </Fragment>) : renderRows(group.rows)}
  </Fragment>)}</tbody>;
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

export default function BroadcastWorkbook({ name, sheet, reviews }: {
  name: SheetName; sheet: ResearchSheet | null; reviews: SavedMarket[];
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saved, setSaved] = useState(() => new Map(reviews.map(review => [review.review_key, review])));
  const [issue, setIssue] = useState<MarketIssue | null>(null);
  const [preview, setPreview] = useState<SourceFile | null>(null);
  const [submissions, setSubmissions] = useState<SourceFile[] | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [grouping, setGrouping] = useState<Grouping>(noGrouping);
  const grid = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setFilters(readFilters());
    setGrouping(readGrouping(name));
    try {
      const preference = localStorage.getItem(sidebarKey);
      setSidebarOpen(preference === null ? !matchMedia('(max-width: 700px)').matches : preference === 'open');
    } catch { /* The control works for this page without browser storage. */ }
  }, [name]);

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
    setFilters(value);
    rememberFilters(value);
    if (grid.current) grid.current.scrollTop = 0;
  }

  function changeGrouping(value: Grouping) {
    setGrouping(value);
    rememberGrouping(name, value);
    grid.current?.scrollTo(0, 0);
  }

  const isTv = name === 'tv';
  const radioColumns = sheet && name === 'radio' ? {
    cpm: sheet.columns.findIndex(column => column.label === 'CPM'),
    rate: sheet.columns.findIndex(column => column.label === 'Spot rate'),
    aqh: sheet.columns.findIndex(column => column.label === 'AQH (people)'),
  } : null;
  const columns = sheet ? [...columnsBeforeMetrics, ...sheet.columns, ...(isTv ? [reviewColumn] : []), sourceColumn] : [];
  const marketName = (row: ResearchRow) => saved.get(row.issue?.key ?? '')?.market_name ?? row.market;
  const rows = sheet && (isTv && saved.size > 0
    ? sheet.rows.toSorted((a, b) => marketName(a).localeCompare(marketName(b))) : sheet.rows);
  const entries: Entry[] = sheet && rows ? rows.map(row => {
    const files = submissionsFor(sheet, row);
    return { row, market: marketName(row), files,
      rep: [...new Set(files.map(file => file.rep))].join(', '),
      firm: [...new Set(files.map(file => file.firm))].join(', ') };
  }) : [];
  const filterOptions = {
    market: [...new Set(entries.map(entry => entry.market))],
    rep: [...new Set(entries.flatMap(entry => entry.files.map(file => file.rep)))],
    client: [...new Set(entries.map(entry => entry.row.client))],
    firm: [...new Set(entries.flatMap(entry => entry.files.map(file => file.firm)))],
  };
  for (const field of filterFields) filterOptions[field] = filterOptions[field].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const visible = entries.filter(({ row, market, files }) =>
    (!filters.market || market === filters.market) &&
    (!filters.client || row.client === filters.client) &&
    (!(filters.rep || filters.firm) || files.some(file =>
      (!filters.rep || file.rep === filters.rep) && (!filters.firm || file.firm === filters.firm))));

  const groupFields: GroupField[] = columnsBeforeMetrics.map(({ label }) => ({
    id: label, label,
    value: (entry) => label === 'Client' ? entry.row.client : entry[label.toLowerCase() as 'market' | 'rep' | 'firm'],
  }));
  const metricGroups = sheet?.groups?.flatMap(group => Array<string>(group.span).fill(group.label)) ?? [];
  for (const [index, column] of (sheet?.columns ?? []).entries()) {
    const label = [metricGroups[index], column.label].filter(Boolean).join(' · ');
    groupFields.push({
      id: label + '/' + index,
      label,
      value: ({ row }) => {
        if (radioColumns?.cpm !== index) return cellText(row.cells[index]);
        const cpm = calculateRadioCpm(measurementValue(row.cells[radioColumns.rate]), measurementValue(row.cells[radioColumns.aqh]));
        return cpm === null ? '' : currency.format(cpm);
      },
    });
  }
  if (isTv) groupFields.push({ id: reviewColumn.label, label: reviewColumn.label,
    value: ({ row }) => row.issue ? (saved.has(row.issue.key) ? 'Reviewed' : row.issue.sourceMarket) : '' });
  groupFields.push({ id: sourceColumn.label, label: sourceColumn.label, value: ({ files }) => files[0]?.name ?? '' });
  const primary = groupFields.find(field => field.id === grouping.primary);
  const secondary = primary && grouping.secondary !== primary.id ? groupFields.find(field => field.id === grouping.secondary) : undefined;
  const activeGrouping = { primary: primary?.id ?? '', secondary: secondary?.id ?? '' };

  const useRadioMatrix = radioColumns && primary && secondary &&
    [primary.label, secondary.label].includes('Market') && [primary.label, secondary.label].includes('Daypart');
  const periodFor = ({ row }: Entry) => row.period ?? '';
  const periods = useRadioMatrix ? [...new Set(visible.map(periodFor))].sort() : [];
  const matrixMetrics = ['AQH (people)', 'AQH Share', 'Cume (people)'];
  if (useRadioMatrix && visible.some(({ row }) => measurementValue(row.cells[radioColumns.rate]) !== null)) {
    matrixMetrics.push('Spot rate', 'CPM');
  }
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

  return <section className="broadcast-workbook" data-sidebar-open={sidebarOpen}>
    <header className="broadcast-header">
      <button type="button" className="broadcast-sidebar-toggle" aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} onClick={toggleSidebar}>
        <span aria-hidden="true">☰</span>
      </button>
      <h1>Broadcast Research</h1>
    </header>
    {sheet && <FilterRibbon filters={filters} options={filterOptions} onChange={changeFilters}>
      <GroupControl choices={groupFields} grouping={activeGrouping} onChange={changeGrouping} />
    </FilterRibbon>}
    {sheet && rows ? <div ref={grid} className="broadcast-grid" role="region" aria-label={sheetLabels[name] + ' sheet'} tabIndex={0}>
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
        <GroupBody entries={visible} primary={primary} secondary={secondary} width={headerColumns.length + 1} renderRows={section => {
          if (section.length === 0) {
            return <tr><td colSpan={headerColumns.length + 1} className="broadcast-no-matches">No rows match these filters.</td></tr>;
          }
          if (useRadioMatrix && radioColumns) {
            const stationAt = radioIndices.get('Station')!;
            const daypartAt = radioIndices.get('Daypart')!;
            const audienceAt = radioIndices.get('Audience')!;
            const coverageAt = radioIndices.get('Coverage')!;
            const series = rowsByPeriod(section, ({ row, market }) => JSON.stringify([
              market, row.client, row.cells[stationAt], row.cells[daypartAt], row.cells[audienceAt], row.cells[coverageAt], row.sourceKeys,
            ]), periodFor);
            return series.map((byPeriod, index) => {
              const lead = byPeriod.values().next().value!;
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
            });
          }
          return section.map((entry, index) => {
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
          });
        }} />
      </table>
    </div> : <p className="broadcast-no-data">No research has been imported yet.</p>}
    <nav className="broadcast-tabs" aria-label="Workbook sheets">
      {Object.entries(sheetLabels).map(([id, label]) => <Link key={id} href={'/research/broadcast?sheet=' + id}
        scroll={false} prefetch={false} aria-current={name === id ? 'page' : undefined}>{label}</Link>)}
    </nav>
    <div className="broadcast-count" role="status">
      <span>{number.format(visible.length)}{visible.length !== entries.length && ' of ' + number.format(entries.length)}
        {useRadioMatrix ? ' source rows' : ' rows'}</span>
      {radioColumns && <span>CPM = {radioCpmFormula}</span>}
      {sheet && <span>{number.format(sheet.totals.values)} values · {number.format(sheet.totals.files)} original files</span>}
    </div>
    {issue && <ReviewDialog issue={issue} current={saved.get(issue.key)} options={marketOptions} onClose={closeReview}
      onSave={entry => { setSaved(previous => new Map(previous).set(entry.review_key, entry)); closeReview(); }} />}
    {submissions && <SubmissionsDialog files={submissions} onClose={() => setSubmissions(null)}
      onOpen={file => { setSubmissions(null); setPreview(file); }} />}
    {preview && <FilePreviewDrawer file={{ id: preview.id, name: preview.name, market: preview.market ?? 'Unassigned',
      sender: preview.rep + ' · ' + preview.firm }} onClose={() => setPreview(null)} />}
  </section>;
}
