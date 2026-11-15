import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { batchKey, type CellValue, type ResearchRow, type ResearchSheet, type SheetName, type SourceFile } from '../lib/broadcast/workbook';

type Submission = SourceFile & {
  sha256: string; state: string; market_id: string | null; campaign_key: string; client_id: string;
};

type Original = { name: string; hash: string; submissions: { market: string }[] };
type Observation = {
  doc: string; tab: string; cell: string; raw: string; value: string | number | null; unit: string;
  family: string; market: string; marketId: string; marketCandidates?: [string, string][]; state: string;
  period: string; issuePeriod?: string; level?: string; daypart?: string; station?: string;
  audience?: string; scope?: string; codes?: string; quarter?: string; adLength?: string | number;
  population?: string | number; context?: { market?: string };
  metric: string;
};
type NoteSource = { doc: string; source: string };
type Note = NoteSource & { sources?: NoteSource[]; market: string; stations?: string[]; kind: string; dates?: string[]; text: string; issue?: string; state: string };
type Reference = NoteSource & { market?: string; title: string; kind: string; stationCity?: string; facility?: string; rf?: string[]; levels?: string[]; unit?: string };
type Extraction = {
  docs: Record<string, Original>; rows: Observation[]; notes: Note[]; references: Reference[];
  catalogMarkets: { id: string; name: string }[];
  scope: { clientId: string; campaignKey: string };
  counts: { submissions: number; files: number; observations: number };
};

const [extractionPath, inventoryPath, outputPath] = process.argv.slice(2);
if (!extractionPath || !inventoryPath || !outputPath) {
  throw new Error('Usage: tsx scripts/prepare-broadcast-research.ts EXTRACTION_JS PRODUCTION_INVENTORY_JSON OUTPUT_SQL');
}

const text = readFileSync(extractionPath, 'utf8').trim();
const prefix = 'const trialResults = ';
if (!text.startsWith(prefix) || !text.endsWith(';')) throw new Error('Expected the verified extraction export.');
const extraction = JSON.parse(text.slice(prefix.length, -1)) as Extraction;
if ([extraction.scope.clientId, extraction.scope.campaignKey].join('/') !== batchKey) throw new Error('The report belongs to a different batch.');

const inventory = (JSON.parse(readFileSync(inventoryPath, 'utf8')) as Submission[])
  .filter(file => file.campaign_key === extraction.scope.campaignKey && file.state === 'ready');
const client = extraction.scope.clientId.toUpperCase();
const origins = new Map(Object.entries(extraction.docs));
const expected = extraction.counts;
if (inventory.length !== expected.submissions || new Set(inventory.map(file => file.id)).size !== inventory.length ||
    inventory.some(file => file.client_id !== extraction.scope.clientId) ||
    origins.size !== expected.files || extraction.rows.length !== expected.observations) {
  throw new Error('The current inventory and extraction differ. Reconcile all uploads before importing.');
}
const sources: ResearchSheet['sources'] = {};
const used = new Set<string>();
for (const original of origins.values()) {
  const files = inventory.filter(file => file.sha256 === original.hash && file.name === original.name);
  const actualMarkets = files.map(file => file.market || 'Unassigned').sort();
  const expectedMarkets = original.submissions.map(file => file.market).sort();
  if (JSON.stringify(actualMarkets) !== JSON.stringify(expectedMarkets)) {
    throw new Error('Submission markets or counts differ for ' + original.name);
  }
  if (files.some(file => !file.rep || !file.firm || used.has(file.id))) throw new Error('Missing or duplicate attribution for ' + original.name);
  files.forEach(file => used.add(file.id));
  sources[original.hash] = { files: files.map(({ id, name, market, rep, firm, market_id }) =>
    ({ id, name, market, rep, firm, marketId: market_id })) };
}
if (used.size !== inventory.length) throw new Error('Some submissions have no extracted source.');

const markets = new Map(extraction.catalogMarkets.map(market => [market.id, market.name]));
const sourceKey = (doc: string) => {
  const original = origins.get(doc);
  if (!original) throw new Error('Unknown extraction source ' + doc);
  return original.hash;
};
const idFor = (parts: (string | number | undefined)[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
let valueCount = 0;
function cell(row?: Observation): CellValue {
  if (!row) return null;
  valueCount++;
  const locator = row.tab + '!' + row.cell;
  if (row.value === null) return { value: null, unit: row.unit, locator, raw: row.raw };
  const numeric = Number(row.value);
  if (!Number.isFinite(numeric)) throw new Error('Invalid number at ' + locator);
  return { value: numeric, unit: row.unit, locator, raw: row.raw };
}

function pivot(
  matches: (row: Observation) => boolean,
  rowKey: (row: Observation) => (string | number | undefined)[],
  colKey: (row: Observation) => string,
  toCells: (row: Observation, values: Map<string, Observation>) => CellValue[],
): ResearchRow[] {
  const groups = new Map<string, { lead: Observation; values: Map<string, Observation> }>();
  for (const row of extraction.rows.filter(matches)) {
    const id = idFor(rowKey(row));
    if (!groups.has(id)) groups.set(id, { lead: row, values: new Map() });
    const group = groups.get(id)!;
    const column = colKey(row);
    if (group.values.has(column)) throw new Error('Duplicate observation at ' + row.doc + ' ' + row.cell);
    group.values.set(column, row);
  }
  return Array.from(groups, ([id, { lead, values }]) => {
    const hash = sourceKey(lead.doc);
    const candidates = (lead.marketCandidates ?? []).map(([marketId]) => marketId);
    const matched = lead.marketId || (candidates.length === 1 ? candidates[0] : '');
    return {
      id,
      market: markets.get(matched) ?? lead.market,
      client,
      period: lead.period,
      cells: toCells(lead, values),
      sourceKeys: [hash],
      sourceMarketId: matched,
      locator: lead.tab + '!' + (lead.context?.market ?? lead.cell),
      ...(lead.state === 'Needs review' || lead.state === 'Deferred' ? {
        issue: { key: idFor([hash, lead.market]), sourceMarket: lead.market, candidates },
      } : {}),
    };
  });
}

const totals = { values: expected.observations, files: expected.files, submissions: expected.submissions };
function sheet(columns: [string, number][], rows: ResearchRow[], groups?: [string, number][]): ResearchSheet {
  if (rows.some(row => row.cells.length !== columns.length)) throw new Error('Spreadsheet columns do not match its rows.');
  const hashes = new Set(rows.flatMap(row => row.sourceKeys));
  return { columns: columns.map(([label, width]) => ({ label, width })),
    ...(groups ? { groups: groups.map(([label, span]) => ({ label, span })) } : {}),
    rows, sources: Object.fromEntries([...hashes].map(hash => [hash, sources[hash]])), totals };
}

const dayparts = ['Early Morning', 'Early News', 'Late News'];
const levels = ['Avg', 'High', 'Low'];
const tvRows = pivot(row => row.family === 'TV benchmark',
  row => [row.doc, row.tab, row.market, row.period, row.level, row.audience, row.adLength],
  row => row.daypart + ' ' + row.metric,
  (row, values) => [row.issuePeriod ?? row.period, row.level ?? '',
    ...dayparts.flatMap(part => ['CPM', 'CPP'].map(metric => cell(values.get(part + ' ' + metric)))),
    row.audience ?? '', row.adLength ?? '', row.quarter ?? '', row.population ? count.format(Number(row.population)) : '']);
tvRows.sort((a, b) => a.market.localeCompare(b.market) || (a.period ?? '').localeCompare(b.period ?? '') ||
  levels.indexOf(String(a.cells[1])) - levels.indexOf(String(b.cells[1])));

const radioRows = pivot(row => row.family.startsWith('Radio'),
  row => [row.doc, row.tab, row.market, row.station, row.period, row.daypart, row.audience, row.scope],
  row => row.metric,
  (row, values) => [row.station ?? '', null, cell(values.get('Spot rate')), row.daypart ?? '', row.period, ...['AQH', 'AQH share', 'Cume'].map(metric => cell(values.get(metric))),
    row.audience ?? '', row.scope ?? '']);

const demographicColumn = (row: Observation) => JSON.stringify([row.tab, row.metric, row.unit]);
const topics = [...new Set(extraction.rows.filter(row => row.family === 'Demographics').map(row => row.tab))];
const demographicFields = [...new Map(extraction.rows.filter(row => row.family === 'Demographics')
  .map(row => [demographicColumn(row), row])).values()];
const orderedFields = topics.flatMap(topic => demographicFields.filter(row => row.tab === topic));
const demographicRows = pivot(row => row.family === 'Demographics',
  row => [row.doc, row.market, row.scope, row.codes],
  demographicColumn,
  (row, values) => [row.scope ?? '', row.period, ...orderedFields.map(field => cell(values.get(demographicColumn(field))))]);
demographicRows.sort((a, b) => a.market.localeCompare(b.market));

const notes = extraction.notes.map((note): ResearchRow => {
  const links = note.sources ?? [note];
  return { id: idFor(links.flatMap(link => [link.doc, link.source])), market: note.market, client,
    cells: [note.stations?.join(', ') ?? '', note.kind, note.dates?.join(', ') ?? '', note.text, note.issue ?? ''],
    sourceKeys: [...new Set(links.map(link => sourceKey(link.doc)))],
    locator: links.map(link => link.source).join(', '), attention: note.state === 'Needs review' };
});

const reference = extraction.references.map((ref): ResearchRow => ({
  id: idFor([ref.doc, ref.source]), market: ref.market ?? '', client,
  cells: [ref.title, ref.kind, ref.stationCity ?? '', ref.facility ?? '', ref.rf?.join(', ') ?? '',
    ref.levels ? ref.levels.join(', ') + ' ' + ref.unit : ''],
  sourceKeys: [sourceKey(ref.doc)], locator: ref.source,
}));

const sheets: Record<SheetName, ResearchSheet> = {
  tv: { ...sheet([['Period', 73], ['Level', 51], ...dayparts.flatMap((): [string, number][] => [['CPM', 67], ['CPP', 67]]),
    ['Audience', 110], ['Spot (sec)', 74], ['Quarter', 71], ['Market population', 121]], tvRows,
    [['', 2], ...dayparts.map((part): [string, number] => [part, 2]), ['', 4]]), markets: extraction.catalogMarkets },
  radio: sheet([['Station', 103], ['CPM', 69], ['Spot rate', 80], ['Daypart', 112], ['Period', 76], ['AQH (people)', 97], ['AQH Share', 85],
    ['Cume (people)', 98], ['Audience', 105], ['Coverage', 162]], radioRows),
  demographics: sheet([['Coverage in file', 235], ['Year', 60], ...orderedFields.map((field): [string, number] =>
    [field.metric + ' (' + (field.unit === 'percent' ? '%' : field.unit) + ')', Math.min(183, Math.max(94, 53 + field.metric.length * 2))])],
    demographicRows, [['', 2], ...topics.map((topic): [string, number] => [topic, orderedFields.filter(field => field.tab === topic).length])]),
  notes: sheet([['Station', 124], ['Event', 123], ['Date in file', 133], ['Details', 380], ['Review', 220]], notes),
  reference: sheet([['Document', 224], ['Type', 111], ['Station city', 155], ['FCC facility', 90],
    ['RF channels', 105], ['Contour levels', 144]], reference),
};

if (valueCount !== expected.observations) throw new Error('The workbook dropped or duplicated an extracted observation.');
const referenced = new Set(Object.values(sheets).flatMap(sheet => Object.keys(sheet.sources)));
if (referenced.size !== origins.size) throw new Error('The workbook has unrepresented source files.');

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const tuples = Object.entries(sheets).map(([name, data]) =>
  '(' + [quote(batchKey), quote(name), quote(JSON.stringify(data)) + '::jsonb'].join(', ') + ')');
const statements = [
  'begin;',
  'insert into public.ff_broadcast_research_sheets (batch_key, sheet, content) values',
  tuples.join(',\n'),
  'on conflict (batch_key, sheet) do update set content = excluded.content, imported_at = now()',
  'where ff_broadcast_research_sheets.content is distinct from excluded.content;',
  'commit;',
];
writeFileSync(outputPath, statements.join('\n') + '\n', { mode: 0o600 });
console.log('Reconciled ' + expected.submissions + ' submissions, ' + expected.files + ' original files, ' + valueCount + ' values.');
console.log(Object.entries(sheets).map(([name, data]) => name + ': ' + data.rows.length + ' rows').join(', '));
