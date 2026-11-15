'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { filePreviewKind } from '@/lib/research/file-preview';
import { sheetLabels, type CellValue, type MarketIssue, type MarketOption, type ResearchRow,
  type ResearchSheet, type SavedMarket, type SheetName, type SourceFile } from '@/lib/broadcast/workbook';
import FilePreviewDrawer from '../_components/FilePreviewDrawer';
import { saveBroadcastMarket } from './actions';

const number = new Intl.NumberFormat('en-US');
const measurement = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const sidebarKey = 'final-fore:broadcast-research:sidebar';
const columnsBeforeMetrics = [
  { label: 'Market', width: 144 }, { label: 'Rep', width: 124 }, { label: 'Firm', width: 112 },
];
const sourceColumn = { label: 'Source file', width: 355 };
const reviewColumn = { label: 'Market review', width: 168 };

function columnLetter(index: number): string {
  const suffix = String.fromCharCode(65 + index % 26);
  return index < 26 ? suffix : columnLetter(Math.floor(index / 26) - 1) + suffix;
}

function submissionsFor(sheet: ResearchSheet, row: ResearchRow) {
  const files = row.sourceKeys.flatMap(key => sheet.sources[key]?.files ?? []);
  if (!row.sourceMarketId) return files;
  return files.toSorted((a, b) => Number(b.marketId === row.sourceMarketId) - Number(a.marketId === row.sourceMarketId));
}

function ResearchCell({ cell, missingRate }: { cell: CellValue; missingRate?: boolean }) {
  if (missingRate) return <td className="broadcast-number broadcast-unavailable-value" title="Spot rate missing">—</td>;
  if (cell === null || typeof cell !== 'object') return <td>{cell}</td>;
  const source = cell.locator + ' · Source value ' + cell.raw;
  const display = cell.value === null ? 'Unavailable'
    : cell.unit === 'USD' ? currency.format(cell.value)
    : measurement.format(cell.value) + (cell.unit === 'percent' ? '%' : '');
  return <td className={cell.value === null ? 'broadcast-number broadcast-unavailable-value' : 'broadcast-number'}
    data-source-cell={cell.locator} title={source}>{display}</td>;
}

function SourceControl({ file, onOpen }: { file: SourceFile; onOpen: (file: SourceFile) => void }) {
  return filePreviewKind(file.name)
    ? <button type="button" className="broadcast-link" onClick={() => onOpen(file)}>{file.name}</button>
    : <a href={'/api/research/files/download?id=' + encodeURIComponent(file.id)}>{file.name}</a>;
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
  const grid = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      const preference = localStorage.getItem(sidebarKey);
      setSidebarOpen(preference === null ? !matchMedia('(max-width: 700px)').matches : preference === 'open');
    } catch { /* The control works for this page without browser storage. */ }
  }, []);

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

  const isTv = name === 'tv';
  const columns = sheet ? [...columnsBeforeMetrics, ...sheet.columns, ...(isTv ? [reviewColumn] : []), sourceColumn] : [];
  const marketName = (row: ResearchRow) => saved.get(row.issue?.key ?? '')?.market_name ?? row.market;
  const rows = sheet && (isTv && saved.size > 0
    ? sheet.rows.toSorted((a, b) => marketName(a).localeCompare(marketName(b))) : sheet.rows);
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
      <span>EPIC3</span>
    </header>
    {sheet && rows ? <div ref={grid} className="broadcast-grid" role="region" aria-label={sheetLabels[name] + ' sheet'} tabIndex={0}>
      <table>
        <colgroup><col style={{ width: 40 }} />{columns.map((column, index) => <col key={index} style={{ width: column.width }} />)}</colgroup>
        <thead>
          <tr className="broadcast-letters" aria-hidden="true"><th className="broadcast-row-number" />
            {columns.map((_, index) => <th className={index === 0 ? 'broadcast-market' : undefined} key={index}>{columnLetter(index)}</th>)}
          </tr>
          {sheet.groups && <tr className="broadcast-groups" aria-hidden="true"><th className="broadcast-row-number" />
            <th className="broadcast-market" /><th colSpan={2} />
            {sheet.groups.map((group, index) => <th key={index} colSpan={group.span}>{group.label}</th>)}
            <th colSpan={isTv ? 2 : 1} />
          </tr>}
          <tr className={sheet.groups ? 'broadcast-column-labels broadcast-grouped' : 'broadcast-column-labels'}>
            <th className="broadcast-row-number" aria-hidden="true" />
            {columns.map((column, index) => <th className={index === 0 ? 'broadcast-market' : undefined}
              key={index} scope="col">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>{rows.map((row, index) => {
          const files = submissionsFor(sheet, row);
          const source = files[0];
          const review = row.issue;
          const flagged = Boolean(row.attention || review && !saved.has(review.key));
          const rep = [...new Set(files.map(file => file.rep))].join(', ');
          const firm = [...new Set(files.map(file => file.firm))].join(', ');
          function reviewMarket(element: HTMLButtonElement) {
            reviewTrigger.current = element;
            setIssue(review ?? null);
          }
          return <tr key={row.id} className={flagged ? 'broadcast-flagged' : undefined}>
            <td className="broadcast-row-number" aria-hidden="true">{index + 2}</td>
            <th className="broadcast-market" scope="row">
              {marketName(row)}
              {review && flagged && <button type="button" className="broadcast-link broadcast-market-action"
                title={'Market in file: ' + review.sourceMarket}
                onClick={event => reviewMarket(event.currentTarget)}>Check market</button>}
            </th>
            <td>{rep}</td><td>{firm}</td>
            {row.cells.map((cell, col) => <ResearchCell key={col} cell={cell}
              missingRate={name === 'radio' && sheet.columns[col].label === 'CPM' && cell === null} />)}
            {isTv && <td>{review && <button type="button" className="broadcast-link"
              onClick={event => reviewMarket(event.currentTarget)}>{flagged ? review.sourceMarket : 'Edit match'}</button>}</td>}
            <td className="broadcast-source-cell" title={row.locator}>{source && <SourceControl file={source} onOpen={setPreview} />}
              {files.length > 1 && <button type="button" className="broadcast-link broadcast-related"
                onClick={() => setSubmissions(files)}>{files.length} {row.sourceKeys.length > 1 ? 'sources' : 'submissions'}</button>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p className="broadcast-no-data">No research has been imported yet.</p>}
    <nav className="broadcast-tabs" aria-label="Workbook sheets">
      {Object.entries(sheetLabels).map(([id, label]) => <Link key={id} href={'/research/broadcast?sheet=' + id}
        scroll={false} prefetch={false} aria-current={name === id ? 'page' : undefined}>{label}</Link>)}
    </nav>
    <div className="broadcast-count" role="status">
      <span>{number.format(rows?.length ?? 0)} rows</span>
      {name === 'radio' && sheet && <span>CPM needs a spot rate</span>}
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
