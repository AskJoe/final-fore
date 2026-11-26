import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCampaignRoute } from '../lib/campaign-routes';
import { campaignKey } from '../lib/service';
import { MemoryStore } from './memory-store';

const campaign = (id: string, name: string, clientId: string, year: number, workflow?: string,
  updatedAt = '2026-11-10T12:00:00Z') => ({
  id: campaignKey(id), kind: 'campaign', updatedAt, payload: { id, name, clientId, year, workflow }
});

test('legacy campaign links use the latest matching active campaign for the same client and year', async () => {
  const store = new MemoryStore([
    campaign('legacy', 'Weed Man 2027', 'weed-man', 2027),
    campaign('earlier', 'Weed Man 2027', 'epic3', 2027, 'broadcast'),
    campaign('current', 'Weed Man 2027', 'epic3', 2027, 'broadcast', '2026-11-12T12:00:00Z'),
    campaign('different-name', 'Another campaign', 'epic3', 2027, 'broadcast', '2026-11-13T12:00:00Z'),
    campaign('different-client', 'Weed Man 2027', 'other', 2027, 'broadcast', '2026-11-13T12:00:00Z'),
    campaign('different-year', 'Weed Man 2027', 'epic3', 2028, 'broadcast', '2026-11-13T12:00:00Z')
  ]);
  assert.deepEqual(await resolveCampaignRoute(store, 'legacy'), { id: 'current', clientId: 'epic3', year: 2027, legacy: true });
  assert.deepEqual(await resolveCampaignRoute(store, 'earlier'), { id: 'earlier', clientId: 'epic3', year: 2027, legacy: false });
});

test('legacy campaign links preserve scope when there is no unambiguous replacement', async () => {
  const store = new MemoryStore([
    campaign('legacy', 'Older plan', 'epic3', 2027, 'digital'),
    campaign('one', 'Another plan', 'epic3', 2027, 'broadcast'),
    campaign('two', 'A third plan', 'epic3', 2027, 'broadcast')
  ]);
  assert.deepEqual(await resolveCampaignRoute(store, 'legacy'), { id: undefined, clientId: 'epic3', year: 2027, legacy: true });
  assert.equal(await resolveCampaignRoute(store, 'missing'), null);
});
