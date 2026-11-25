import assert from 'node:assert/strict';
import test from 'node:test';
import { orderPdfMarkup } from '../lib/orders/print-markup';
import { cleanOrderDocument } from '../lib/orders/store';

test('market order paperwork shows both sections when only Broadcast has placements', () => {
  const marketId = 'epic3-arkansas-nwa';
  const doc = cleanOrderDocument({ lines: [{ id: 'tv', marketId, media: 'TV', program: 'News', amount: 576000 }] },
    { marketIds: [marketId], workflow: 'broadcast' });
  for (const draft of [true, false]) {
    const pdf = orderPdfMarkup(doc, '', {}, draft, true);
    assert.match(pdf, /BROADCAST ADS/);
    assert.match(pdf, /DIGITAL ADS/);
    assert.match(pdf, /No Digital placements/);
    assert.match(pdf, /TOTAL DUE &nbsp; \$5,760\.00/);
  }
  assert.doesNotMatch(orderPdfMarkup(doc, '', {}, true), /DIGITAL ADS/);
});
