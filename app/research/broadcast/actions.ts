'use server';

import { createHash } from 'node:crypto';
import { requireMember } from '@/lib/access';
import { researchAdmin } from '@/lib/research/config';
import { loadBroadcastSheet } from '@/lib/broadcast/store';
import { batchKey, type MarketOption, type SavedMarket } from '@/lib/broadcast/workbook';

type Result = { saved: SavedMarket; error?: never } | { error: string; saved?: never };
const nameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export async function saveBroadcastMarket(key: string, mode: string, choice: string): Promise<Result> {
  const { user } = await requireMember();
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key) || typeof choice !== 'string' ||
      choice.length > 120 || !['confirm', 'change', 'create'].includes(mode)) {
    return { error: 'Choose a valid market.' };
  }

  const { sheet, reviews } = await loadBroadcastSheet('tv');
  const issue = sheet?.rows.find(row => row.issue?.key === key)?.issue;
  if (!issue) return { error: 'This market review is no longer available.' };
  const options = new Map<string, MarketOption>();
  sheet?.markets?.forEach(market => options.set(market.id, market));
  for (const review of reviews) {
    if (review.market_id.startsWith('broadcast-')) {
      options.set(review.market_id, { id: review.market_id, name: review.market_name });
    }
  }

  let market = options.get(choice);
  if (mode === 'confirm' && !issue.candidates.includes(choice)) return { error: 'Choose a suggested market.' };
  if (mode === 'create') {
    const name = choice.trim().replace(/\s+/g, ' ');
    if (!name) return { error: 'Enter a market name.' };
    if ([...options.values()].some(option => nameKey(option.name) === nameKey(name))) {
      return { error: 'This market already exists. Choose it from the market list.' };
    }
    const id = 'broadcast-' + createHash('sha256').update(batchKey + '/' + nameKey(name)).digest('hex');
    market = { id, name };
  }
  if (!market) return { error: 'Choose a market from the list.' };

  const saved: SavedMarket = { review_key: key, market_id: market.id, market_name: market.name };
  const { error } = await researchAdmin().from('ff_broadcast_research_market_reviews').upsert(
    { ...saved, batch_key: batchKey, reviewed_by: user.id, reviewed_at: new Date().toISOString() },
    { onConflict: 'batch_key,review_key' },
  );
  if (error) return { error: 'The market review could not be saved. Try again.' };
  return { saved };
}
