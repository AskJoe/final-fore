import { groupRows, rowsByPeriod } from './grouping';
import { calculateRadioCpm, type CellValue, type ResearchRow, type ResearchSheet, type SavedMarket, type SheetName, type SourceFile } from './workbook';

export const filterFields = ['market', 'rep', 'client', 'firm'] as const;
export type Filters = Record<typeof filterFields[number], string>;
export const emptyFilters: Filters = { market: '', rep: '', client: '', firm: '' };
export type Grouping = { primary: string; secondary: string };
export const noGrouping: Grouping = { primary: '', secondary: '' };
export const defaultQuery = { filters: emptyFilters, grouping: noGrouping, page: 1 };
export type ViewQuery = typeof defaultQuery;
export const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const measurement = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export function cellText(cell: CellValue) {
  if (cell === null || typeof cell !== 'object') return String(cell ?? '');
  return cell.value === null ? 'Unavailable' : cell.unit === 'USD' ? currency.format(cell.value)
    : measurement.format(cell.value) + (cell.unit === 'percent' ? '%' : '');
}
export function measurementValue(cell: CellValue | undefined): number | null {
  if (typeof cell === 'number') return cell;
  return typeof cell === 'object' && cell !== null ? cell.value : null;
}
export type Entry = { row: ResearchRow; market: string; files: SourceFile[]; rep: string; firm: string };
type Field = { id: string; label: string; value: (entry: Entry) => string };
export type Section = { primary?: string; secondary?: string; lines: Entry[][] };

export function radioFields(sheet: Pick<ResearchSheet, 'columns'>, name: SheetName) {
  if (name !== 'radio') return null;
  const index = (label: string) => sheet.columns.findIndex(column => column.label === label);
  return { cpm: index('CPM'), rate: index('Spot rate'), aqh: index('AQH (people)') };
}

export function indexSheet(name: SheetName, sheet: ResearchSheet, reviews: SavedMarket[]) {
  const saved = new Map(reviews.map(review => [review.review_key, review.market_name]));
  const marketName = (row: ResearchRow) => saved.get(row.issue?.key ?? '') ?? row.market;
  const rows = name === 'tv' && saved.size ? sheet.rows.toSorted((a,b) => marketName(a).localeCompare(marketName(b))) : sheet.rows;
  const options = { market: new Set<string>(), rep: new Set<string>(), client: new Set<string>(), firm: new Set<string>() };
  const entries: Entry[] = [];
  // Many observations share the same submission(s) and attribution.
  const attribution = new Map<string, Pick<Entry, 'files' | 'firm' | 'rep'>>();
  for (const row of rows) {
    const key = row.sourceKeys.join('/') + ':' + (row.sourceMarketId ?? '');
    let source = attribution.get(key);
    if (!source) {
      const files = row.sourceKeys.flatMap(hash => sheet.sources[hash]?.files ?? []);
      if (row.sourceMarketId) files.sort((a,b) => Number(b.marketId === row.sourceMarketId) - Number(a.marketId === row.sourceMarketId));
      source = { files, rep: [...new Set(files.map(f => f.rep))].join(', '), firm: [...new Set(files.map(f => f.firm))].join(', ') };
      attribution.set(key, source);
      files.forEach(file => { options.rep.add(file.rep); options.firm.add(file.firm); });
    }
    const market = marketName(row);
    options.market.add(market);
    options.client.add(row.client);
    entries.push({ row, market, ...source });
  }
  const sorted = (values: Set<string>) => [...values].filter(Boolean).sort((a,b) => a.localeCompare(b));
  return { entries, filterOptions: { market: sorted(options.market), client: sorted(options.client), rep: sorted(options.rep), firm: sorted(options.firm) } };
}

export function workbookFields(name: SheetName, sheet: ResearchSheet, reviews: SavedMarket[]) {
  const saved = new Set(reviews.map(review => review.review_key));
  const fields: Field[] = ['Market','Client','Rep','Firm'].map(label => ({
    id: label, label, value: entry => label === 'Client' ? entry.row.client : entry[label.toLowerCase() as 'market'|'rep'|'firm'],
  }));
  const radio = radioFields(sheet, name);
  const bands = sheet.groups?.flatMap(group => Array<string>(group.span).fill(group.label)) ?? [];
  sheet.columns.forEach((column,index) => {
    const label = [bands[index], column.label].filter(Boolean).join(' · ');
    fields.push({ id: label + '/' + index, label, value: ({row}) => {
      if (radio?.cpm !== index) return cellText(row.cells[index]);
      const value = calculateRadioCpm(measurementValue(row.cells[radio.rate]),measurementValue(row.cells[radio.aqh]));
      return value === null ? '' : currency.format(value);
    } });
  });
  if (name === 'tv') fields.push({ id: 'Market review', label: 'Market review', value: ({row}) => row.issue ? saved.has(row.issue.key) ? 'Reviewed' : row.issue.sourceMarket : '' });
  fields.push({ id: 'Source file', label: 'Source file', value: ({files}) => files[0]?.name ?? '' });
  return fields;
}

type IndexCache = WeakMap<ResearchSheet, { reviewKey: string; index: ReturnType<typeof indexSheet> }>;
const runtime = globalThis as typeof globalThis & { ffBroadcastIndexes?: IndexCache };
const indexes = runtime.ffBroadcastIndexes ??= new WeakMap();

export function workbookView(name: SheetName, sheet: ResearchSheet, reviews: SavedMarket[], query: ViewQuery) {
  const reviewKey = JSON.stringify(reviews);
  let item = indexes.get(sheet);
  if (!item || item.reviewKey !== reviewKey) {
    item = { reviewKey, index: indexSheet(name, sheet, reviews) };
    indexes.set(sheet, item);
  }
  const { entries, filterOptions } = item.index;
  const filters = query.filters;
  const visible = Object.values(filters).some(Boolean) ? entries.filter(({row, market, files}) =>
    (!filters.market || filters.market === market) && (!filters.client || filters.client === row.client) &&
    (!(filters.rep || filters.firm) || files.some(file => (!filters.rep || file.rep === filters.rep) && (!filters.firm || file.firm === filters.firm)))
  ) : entries;
  const fields = workbookFields(name, sheet, reviews);
  const radio = radioFields(sheet, name);
  const primary = fields.find(field => field.id === query.grouping.primary);
  const secondary = primary && fields.find(field => field.id !== primary.id && field.id === query.grouping.secondary);
  const matrix = Boolean(radio && primary && secondary && [primary.label, secondary.label].includes('Market') && [primary.label, secondary.label].includes('Daypart'));
  const periods = matrix ? [...new Set(visible.map(entry => entry.row.period ?? ''))].sort() : [];
  const hasRates = Boolean(matrix && radio && visible.some(({row}) => measurementValue(row.cells[radio.rate]) !== null));
  // The monthly layout can span dozens of periods. Bound its cell count as well as its row count.
  const pageSize = matrix ? Math.max(5, Math.min(100, Math.floor(2000 / (10 + periods.length * (hasRates ? 5 : 3))))) : 100;
  const requested = Number.isSafeInteger(query.page) && query.page > 0 ? query.page : 1;
  const identityCols = ['Station','Daypart','Audience','Coverage'].map(label => sheet.columns.findIndex(col => col.label === label));
  const groups = primary ? groupRows(visible, primary.value) : [{ label: undefined, rows: visible }];
  const sections: Section[] = [];
  let lineCount = 0;
  const buckets = groups.flatMap(group => {
    const parts = secondary ? groupRows(group.rows, secondary.value) : [{ label: undefined, rows: group.rows }];
    return parts.map(part => {
      const series = matrix ? rowsByPeriod(part.rows, ({row,market}) => JSON.stringify([market, row.client, ...identityCols.map(i => row.cells[i]), row.sourceKeys]), ({row}) => row.period ?? '') : null;
      const start = lineCount;
      const count = series?.length ?? part.rows.length;
      lineCount += count;
      return { primary: group.label, secondary: part.label, entries: part.rows, series, start, count };
    });
  });
  const pages = Math.max(1, Math.ceil(lineCount / pageSize));
  const page = Math.min(requested, pages);
  const offset = (page - 1) * pageSize;
  for (const bucket of buckets) {
    const from = Math.max(0, offset - bucket.start);
    const to = Math.min(bucket.count, offset + pageSize - bucket.start);
    if (from >= to) continue;
    const lines = bucket.series ? bucket.series.slice(from,to).map(line => [...line.values()]) : bucket.entries.slice(from,to).map(entry => [entry]);
    sections.push({ primary: bucket.primary, secondary: bucket.secondary, lines });
  }
  return {
    sheet: { columns: sheet.columns, groups: sheet.groups, markets: sheet.markets, totals: sheet.totals },
    filterOptions,
    groupFields: fields.map(({id,label}) => ({ id,label })), grouping: { primary: primary?.id ?? '', secondary: secondary?.id ?? '' },
    primaryLabel: primary?.label, secondaryLabel: secondary?.label, sections, matrix, periods, hasRates,
    total: entries.length, matches: visible.length, page, pages, offset,
  };
}
export type WorkbookView = ReturnType<typeof workbookView>;
