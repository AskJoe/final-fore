// Produce a private, versioned database projection from the reviewed workbook.
// VERSION is PostgreSQL encode(sha256(jsonb_send(content)), 'hex') for this radio snapshot.
import { readFileSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { indexSheet, workbookFields, measurementValue, radioFields } from '../lib/broadcast/view';
import type { ResearchSheet } from '../lib/broadcast/workbook';

const [input, version, destination] = process.argv.slice(2);
if (!input || !destination || !/^[a-f0-9]{64}$/.test(version)) {
  throw Error('Usage: tsx scripts/prepare-radio-pages.ts WORKBOOK_JSON VERSION OUTPUT_DIRECTORY');
}
const sheets = JSON.parse(readFileSync(input, 'utf8')) as {sheet: string; content: ResearchSheet}[];
const sheet = sheets.find(record => record.sheet === 'radio')?.content;
if (!sheet) throw Error('Missing radio sheet');
const {entries, filterOptions} = indexSheet('radio', sheet, []);
const fields = workbookFields('radio', sheet, []);
const collator = new Intl.Collator('en', {numeric: true});
const ranks = fields.map(field => {
  const labels = [...new Set(entries.map(field.value))].sort(collator.compare);
  return new Map(labels.map((label, index) => [label, index]));
});
const rate = radioFields(sheet, 'radio')!.rate;
const identityColumns = ['Station', 'Daypart', 'Audience', 'Coverage'].map(name => sheet.columns.findIndex(col => col.label === name));
const attributions = new Map<string, number>();
const series = new Map<string, {first: number; periods: Map<string, number>}>();
mkdirSync(destination, {recursive: true, mode: 0o700});
const output = openSync(join(destination, 'rows.ndjson'), 'w', 0o600);
const sources = [];
try {
  for (const [ordinal, entry] of entries.entries()) {
    const {row, files, firm, rep, market} = entry;
    const source = JSON.stringify([row.sourceKeys, row.sourceMarketId]);
    let attribution = attributions.get(source);
    if (attribution === undefined) {
      attribution = sources.length;
      attributions.set(source, attribution);
      sources.push({version, attribution, files, firm, rep});
    }
    const identity = JSON.stringify([market, row.client, ...identityColumns.map(i => row.cells[i]), row.sourceKeys]);
    const group = series.get(identity) ?? {first: ordinal, periods: new Map<string, number>()};
    series.set(identity, group);
    const period = row.period ?? '';
    const occurrence = group.periods.get(period) ?? 0;
    group.periods.set(period, occurrence + 1);
    const indexed = {version, ordinal, body: row, market, client: row.client, attribution,
      ranks: fields.map((field, i) => ranks[i].get(field.value(entry))), series: group.first,
      occurrence, period, rated: measurementValue(row.cells[rate]) !== null};
    writeSync(output, JSON.stringify(indexed) + '\n');
  }
} finally { closeSync(output); }
const header = {columns: sheet.columns, groups: sheet.groups, markets: sheet.markets, totals: sheet.totals};
writeFileSync(join(destination, 'catalog.json'), JSON.stringify({version, total: entries.length, header,
  options: filterOptions, fields: fields.map(({id, label}) => ({id, label}))}), {mode: 0o600});
writeFileSync(join(destination, 'sources.json'), JSON.stringify(sources), {mode: 0o600});
console.log(entries.length + ' radio rows indexed with ' + sources.length + ' source attributions');
