import { parseFromWebStream } from '@discoveryjs/json-ext';
import { supabaseConfig } from '@/utils/supabase/config';
import { requireMember } from '@/lib/access';
import { StorageError } from '@/lib/store';
import { batchKey, type ResearchSheet, type SavedMarket, type SheetName } from './workbook';
import { workbookFields, workbookView, type Entry, type WorkbookView, type ViewQuery } from './view';

type SheetClient = Awaited<ReturnType<typeof requireMember>>['supabase'];
type Snapshot = { revision: string; content: Promise<ResearchSheet | null> };
// The App Router can evaluate this module in separate page and route bundles.
// Share one copy of an imported sheet across both entry points in this process.
const runtime = globalThis as typeof globalThis & { ffBroadcastSnapshots?: Map<SheetName, Snapshot> };
const snapshots = runtime.ffBroadcastSnapshots ??= new Map<SheetName, Snapshot>();

async function readSheet(client: SheetClient, name: SheetName) {
  const table = () => client.from('ff_broadcast_research_sheets').select('imported_at').eq('batch_key', batchKey).eq('sheet', name);
  // RLS and membership are checked on every read, including a cache hit.
  const version = await table().maybeSingle();
  if (version.error) throw new StorageError('Unable to load Broadcast Research.');
  if (!version.data) return null;
  const revision = version.data.imported_at;
  const cached = snapshots.get(name);
  if (cached && cached.revision === revision) return cached.content;
  const content = (async () => {
    // Stream the PostgREST document. Buffering its full UTF-8 and UTF-16 copies
    // alongside the parsed rows exceeds the small production instance's memory.
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new StorageError('Unable to load Broadcast Research.');
    const { url, key } = supabaseConfig();
    const endpoint = new URL('/rest/v1/ff_broadcast_research_sheets', url);
    endpoint.search = new URLSearchParams({ select: 'content', batch_key: 'eq.' + batchKey, sheet: 'eq.' + name,
      imported_at: 'eq.' + revision }).toString();
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, Accept: 'application/vnd.pgrst.object+json' },
      signal: AbortSignal.timeout(60_000), cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new StorageError('Unable to load Broadcast Research.');
    const record = await parseFromWebStream(response.body);
    return record.content as ResearchSheet;
  })();
  const next = { revision, content };
  snapshots.set(name, next);
  try { return await content; }
  catch (error) {
    if (snapshots.get(name) === next) snapshots.delete(name);
    throw error;
  }
}

export async function loadBroadcastSheet(name: Exclude<SheetName, 'radio'>) {
  const { supabase } = await requireMember();
  const [sheet, reviews] = await Promise.all([
    readSheet(supabase, name),
    name === 'tv'
      ? supabase.from('ff_broadcast_research_market_reviews').select('review_key,market_id,market_name').eq('batch_key', batchKey)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (reviews.error) throw new StorageError('Unable to load Broadcast Research.');
  return { sheet, reviews: (reviews.data ?? []) as SavedMarket[] };
}

type RadioPage = Omit<WorkbookView, 'sections' | 'primaryLabel' | 'secondaryLabel'> & {version: string; lines: number[][]};

async function readRadioPage(client: SheetClient, query: ViewQuery): Promise<WorkbookView | null> {
  const {filters, grouping} = query;
  const result = await client.rpc('ff_radio_page', {
    p_batch: batchKey, p_market: filters.market, p_rep: filters.rep, p_firm: filters.firm, p_client: filters.client,
    p_primary: grouping.primary, p_secondary: grouping.secondary,
    p_page: Number.isSafeInteger(query.page) && query.page > 0 ? Math.min(query.page, 2147483647) : 1,
  });
  if (result.error) throw new StorageError('Unable to load Broadcast Research.');
  if (!result.data) return null;
  const {version, lines, ...page} = result.data as RadioPage;
  const ids = lines.flat();
  const entries: Entry[] = [];
  // A monthly display line can contain multiple observations. Each database read
  // is bounded even when several years of periods fit on one display page.
  for (let start = 0; start < ids.length; start += 100) {
    const ordinals = ids.slice(start, start + 100);
    const response = await client.rpc('ff_radio_entries', {p_version: version, p_ordinals: ordinals});
    if (response.error || response.data?.length !== ordinals.length) throw new StorageError('Unable to load Broadcast Research.');
    entries.push(...response.data as Entry[]);
  }
  const fields = workbookFields('radio', {...page.sheet, sources: {}, rows: []}, []);
  const primary = fields.find(field => field.id === page.grouping.primary);
  const secondary = fields.find(field => field.id === page.grouping.secondary);
  const sections: WorkbookView['sections'] = [];
  let position = 0;
  for (const ids of lines) {
    const line = entries.slice(position, position + ids.length);
    position += line.length;
    const group = primary?.value(line[0]);
    const subgroup = secondary?.value(line[0]);
    let section = sections.at(-1);
    if (!section || section.primary !== group || section.secondary !== subgroup) {
      section = {primary: group, secondary: subgroup, lines: []};
      sections.push(section);
    }
    section.lines.push(line);
  }
  return {...page, primaryLabel: primary?.label, secondaryLabel: secondary?.label, sections};
}

export async function loadWorkbookPage(name: SheetName, query: ViewQuery) {
  if (name === 'radio') {
    const {supabase} = await requireMember();
    return {view: await readRadioPage(supabase, query), reviews: [] as SavedMarket[]};
  }
  const { sheet, reviews } = await loadBroadcastSheet(name);
  return { view: sheet ? workbookView(name, sheet, reviews, query) : null, reviews };
}
