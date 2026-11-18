import { parseFromWebStream } from '@discoveryjs/json-ext';
import { supabaseConfig } from '@/utils/supabase/config';
import { requireMember } from '@/lib/access';
import { StorageError } from '@/lib/store';
import { batchKey, type ResearchSheet, type SavedMarket, type SheetName } from './workbook';
import { workbookView, type ViewQuery } from './view';

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

export async function loadBroadcastSheet(name: SheetName) {
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

export async function loadWorkbookPage(name: SheetName, query: ViewQuery) {
  const { sheet, reviews } = await loadBroadcastSheet(name);
  return { view: sheet ? workbookView(name, sheet, reviews, query) : null, reviews };
}
