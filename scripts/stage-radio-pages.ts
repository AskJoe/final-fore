// Stage an immutable version prepared by prepare-radio-pages.ts. Publication is separate.
import {createReadStream, readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';

async function main() {
  const [directory, projectUrl] = process.argv.slice(2);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!directory || !projectUrl || !secret) throw Error('Supply the prepared directory, project URL and SUPABASE_SECRET_KEY');
  const db = createClient(projectUrl, secret, {auth: {persistSession: false, autoRefreshToken: false}});
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
  const catalog = read('catalog.json');
  async function insert(table: string, records: Record<string, unknown>[]) {
    if (!records.every(record => record.version === catalog.version)) throw Error('Mixed snapshot versions');
    // A retry can finish an interrupted immutable version without modifying existing rows.
    const {error} = await db.from(table).upsert(records, {ignoreDuplicates: true});
    if (error) throw Error(table + ': ' + error.code + ' ' + error.message);
  }
  await insert('ff_radio_versions', [catalog]);
  await insert('ff_radio_attributions', read('sources.json'));
  let rows: Record<string, unknown>[] = [];
  let bytes = 0;
  let count = 0;
  for await (const line of createInterface({input: createReadStream(join(directory, 'rows.ndjson')), crlfDelay: Infinity})) {
    const size = Buffer.byteLength(line) + 1;
    if (rows.length && bytes + size > 480_000) {
      await insert('ff_radio_rows', rows);
      rows = [];
      bytes = 0;
    }
    const record = JSON.parse(line);
    if (record.ordinal !== count++) throw Error('Unexpected ordinal');
    bytes += size;
    rows.push(record);
  }
  if (rows.length) await insert('ff_radio_rows', rows);
  const result = await db.from('ff_radio_rows').select('ordinal', {head: true, count: 'exact'}).eq('version', catalog.version);
  if (result.error || result.count !== count || count !== catalog.total) throw Error('Incomplete radio index');
  console.log('Staged ' + count + ' indexed radio rows for version ' + catalog.version);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
