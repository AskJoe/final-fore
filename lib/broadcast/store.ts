import { requireMember } from '@/lib/access';
import { StorageError } from '@/lib/store';
import { batchKey, type ResearchSheet, type SavedMarket, type SheetName } from './workbook';

export async function loadBroadcastSheet(name: SheetName) {
  const { supabase } = await requireMember();
  const requests = [
    supabase.from('ff_broadcast_research_sheets').select('content').eq('batch_key', batchKey).eq('sheet', name).maybeSingle(),
    name === 'tv'
      ? supabase.from('ff_broadcast_research_market_reviews').select('review_key,market_id,market_name').eq('batch_key', batchKey)
      : Promise.resolve({ data: [], error: null }),
  ] as const;
  const [sheet, reviews] = await Promise.all(requests);
  if (sheet.error || reviews.error) throw new StorageError('Unable to load Broadcast Research.');
  return { sheet: (sheet.data?.content ?? null) as ResearchSheet | null, reviews: (reviews.data ?? []) as SavedMarket[] };
}
