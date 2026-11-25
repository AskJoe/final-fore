import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrderChanges } from '../lib/order-assistant/changes';
import { orderPdfMarkup } from '../lib/orders/print-markup';
import { cleanOrderDocument, orderTotal, type OrderDetail } from '../lib/orders/store';
import type { ResearchRow } from '../lib/orders/sources';

const marketId = 'epic3-austin';
const scope = { marketIds: [marketId], workflow: 'broadcast' as const };
const item = (id: string, media: 'TV' | 'Radio' | 'Digital', amount: number, impressions: number | null) =>
  ({ id, media, marketId, program: id, amount, impressions });

test('Austin mixed order includes the management fee once in totals and paperwork', () => {
  const doc = cleanOrderDocument({ lines: [
    item('TV placements', 'TV', 2275000, 1184890),
    item('Radio placements', 'Radio', 1627500, 966000),
    item('iHeart streaming radio', 'Digital', 300000, 187500),
    item('iHeart OTT and preroll', 'Digital', 680000, 206561),
    item('iHeart display', 'Digital', 2600000, 2260870),
    { ...item('Net OTT', 'Digital', 500000, null), feeBasisPoints: 1500 },
  ] }, scope);
  assert.equal(orderTotal(doc), 8057500);
  for (const draft of [true, false]) {
    const pdf = orderPdfMarkup(doc, '', { [marketId]: 'Austin' }, draft);
    for (const label of ['BROADCAST ADS', 'DIGITAL ADS', 'NET DIGITAL ADS', 'Management fee', 'TOTAL DUE',
      '$39,025.00', '$35,800.00', '$5,000.00', '$750.00', '$5,750.00', '$80,575.00', '4,805,821']) {
      assert.ok(pdf.includes(label), label);
    }
  }
});

test('a Digital research proposal carries evidence and keeps historical numbers as reference', () => {
  const document = cleanOrderDocument({ lines: [item('TV', 'TV', 25000, null)] }, scope);
  const order = { ...scope, workflow:'broadcast', document, currentIssue: null } as OrderDetail;
  const quote = cleanOrderDocument({ lines: [{
    ...item('catalog', 'Digital', 300000, 187500), source: {
      kind: 'digital', id: 'catalog', label: 'Workbook', year: 2026,
      facts: [{ label: 'Historical spend', value: 3000, unit: 'USD' }],
    },
  }] }, scope).lines[0];
  const row = { id: 'catalog', marketId, line: quote } as ResearchRow;
  const result = buildOrderChanges(order, { sheet: 'digital', add: [{ rowId: row.id }], remove: [] }, [row], () => 'digital');
  assert.equal(result.lines[0].media, 'TV');
  assert.equal(result.lines[1].amount, null);
  assert.equal(result.lines[1].impressions, null);
  assert.equal(result.lines[1].source?.facts?.[0].value, 3000);
  assert.throws(() => buildOrderChanges(order, { sheet: 'digital', add: [], remove: ['TV'] }, [], () => 'bad'));
  assert.throws(() => buildOrderChanges(order, { sheet: 'digital', add: [{ rowId: row.id }], remove: [] },
    [{ ...row, marketId: 'epic3-denver' }], () => 'bad'));
});
