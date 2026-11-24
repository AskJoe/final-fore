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

async function readSheet(client: SheetClient, name: SheetName, serverKey?:string) {
  const table = () => client.from('ff_broadcast_research_sheets').select('imported_at,assistant_version').eq('batch_key', batchKey).eq('sheet', name);
  // RLS and membership are checked on every read, including a cache hit.
  const version = await table().maybeSingle();
  if (version.error) throw new StorageError('Unable to load Broadcast Research.');
  if (!version.data) return null;
  const importedAt=version.data.imported_at,generation=version.data.assistant_version;
  const revision=importedAt+'|'+(generation??'');
  const cached = snapshots.get(name);
  if (cached && cached.revision === revision) return cached.content;
  const content = (async () => {
    // Stream the PostgREST document. Buffering its full UTF-8 and UTF-16 copies
    // alongside the parsed rows exceeds the small production instance's memory.
    const token=serverKey ?? (await client.auth.getSession()).data.session?.access_token;
    if (!token) throw new StorageError('Unable to load Broadcast Research.');
    const { url, key } = supabaseConfig();
    const endpoint = new URL('/rest/v1/ff_broadcast_research_sheets', url);
    endpoint.search = new URLSearchParams({ select: 'content', batch_key: 'eq.' + batchKey, sheet: 'eq.' + name,
      imported_at: 'eq.' + importedAt, ...(generation?{assistant_version:'eq.'+generation}:{}) }).toString();
    const response = await fetch(endpoint, {
      headers: { apikey: serverKey??key, ...(token.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+token}),
        Accept: 'application/vnd.pgrst.object+json' },
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

type DatabasePage = Omit<WorkbookView, 'sections' | 'primaryLabel' | 'secondaryLabel'> & {lines: Entry[][]; reviews?: SavedMarket[]};

async function readPagedSheet(client: SheetClient, name: 'radio' | 'tv', query: ViewQuery) {
  const {filters, grouping} = query;
  const result = await client.rpc(name === 'radio' ? 'ff_radio_workbook_page' : 'ff_tv_workbook_page', {
    p_batch: batchKey, p_market: filters.market, p_rep: filters.rep, p_firm: filters.firm, p_client: filters.client,
    p_primary: grouping.primary, p_secondary: grouping.secondary,
    p_page: Number.isSafeInteger(query.page) && query.page > 0 ? Math.min(query.page, 2147483647) : 1,
  });
  if (result.error) throw new StorageError('Unable to load Broadcast Research.');
  if (!result.data) return {view: null, reviews: [] as SavedMarket[]};
  const {lines, reviews = [], ...page} = result.data as DatabasePage;
  const fields = workbookFields(name, {...page.sheet, sources: {}, rows: []}, reviews);
  const primary = fields.find(field => field.id === page.grouping.primary);
  const secondary = fields.find(field => field.id === page.grouping.secondary);
  const sections: WorkbookView['sections'] = [];
  for (const line of lines) {
    const group = primary?.value(line[0]);
    const subgroup = secondary?.value(line[0]);
    let section = sections.at(-1);
    if (!section || section.primary !== group || section.secondary !== subgroup) {
      section = {primary: group, secondary: subgroup, lines: []};
      sections.push(section);
    }
    section.lines.push(line);
  }
  return {view: {...page, primaryLabel: primary?.label, secondaryLabel: secondary?.label, sections}, reviews};
}

export async function loadWorkbookPage(name: SheetName, query: ViewQuery, memberClient?: SheetClient, serverKey?:string) {
  const client = memberClient ?? (await requireMember()).supabase;
  if (name === 'radio' || name === 'tv') return readPagedSheet(client, name, query);
  const sheet = await readSheet(client, name, serverKey);
  const reviews: SavedMarket[] = [];
  return { view: sheet ? workbookView(name, sheet, reviews, query) : null, reviews };
}
