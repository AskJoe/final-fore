import assert from 'node:assert/strict';
import test from 'node:test';
import { orderMediaTotals } from '../lib/orders/metrics';
import { cleanOrderDocument, orderTotal } from '../lib/orders/store';
import { calculate } from '../lib/domain/campaigns';

test('campaign media amounts reconcile to the saved order with digital fees included once', () => {
  const marketId = 'epic3-austin';
  const document = cleanOrderDocument({
    lines: [
      { id: 'tv', marketId, media: 'TV', rate: 25000, quantity: 4 },
      { id: 'radio', marketId, media: 'Radio', amount: 50000 },
      { id: 'digital-gross', marketId, media: 'Digital', amount: 300000 },
      { id: 'digital-net', marketId, media: 'Digital', amount: 500000, feeBasisPoints: 1500 },
      { id: 'bonus', marketId, media: 'Digital', amount: 50000, noCharge: true },
      { id: 'unpriced', marketId, media: 'Digital' },
    ],
  }, { workflow: 'broadcast', marketIds: [marketId] });

  const { broadcast, digital } = orderMediaTotals(document.lines);
  assert.deepEqual({ broadcast, digital }, { broadcast: 150000, digital: 875000 });
  assert.equal(broadcast + digital, orderTotal(document));
});

test('campaigns keep a distinct reserve and one allocation for a shared market budget', () => {
  const campaign = {
    name: 'Media campaign', clientId: 'epic3', year: 2027, workflow: 'broadcast',
    budget: 10000000, weatherReserve: 1000000, regions: { Mid: { start: '2027-03-08', end: '2027-05-30' } },
    markets: [
      { marketId: 'epic3-omaha', region: 'Mid', override: 6000000, channels: { r3: 600000 } },
      { marketId: 'epic3-lincoln', region: 'Mid', sharedBudgetMarketId: 'epic3-omaha' },
    ],
  };
  const { details, rows } = calculate(campaign);
  assert.equal(details.weatherReserve, 1000000);
  assert.equal(details.markets[0].channels.r3, 600000);
  assert.equal(rows[1].start, '2027-03-08');
  assert.equal(rows[1].allocation, null);
  assert.equal(rows[1].sharedBudgetMarketId, 'epic3-omaha');
  assert.throws(() => calculate({ ...campaign, markets: [campaign.markets[1]] }), /same campaign/);
});
