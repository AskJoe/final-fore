import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderPdfMarkup } from '../lib/orders/pdf';

test('official paperwork uses the saved document, prints table headings and escapes order text', () => {
  const html = orderPdfMarkup({
    number: 'FFM-027', date: '2027-01-07', clientName: 'Weed Man <West>', vendor: 'Example Radio',
    rep: 'Alex', buyer: 'Final Fore Media', buyerEmail: '', billing: '', terms: 'Net 30',
    start: '2027-02-01', end: '2027-03-01', notes: '<script>window.print()</script>',
    lines: [{ id: 'r', media: 'Radio', marketId: 'west', station: 'WEST-FM', program: 'Morning',
      format: ':30', days: 'M-F', start: '', end: '', rate: 2000, quantity: 64, amount: null,
      impressions: 147200, noCharge: false, notes: '' }]
  }, 'data:image/png;base64,', {west:'West Market'});
  assert.match(html, /Media Order/);
  assert.match(html, /FFM-027/);
  assert.match(html, /Weed Man &lt;West&gt;/);
  assert.ok(html.includes('$1,280.00'));
  assert.match(html, /thead\s*\{\s*display:\s*table-header-group/);
  assert.match(html, /Signature/);
  assert.doesNotMatch(html, /<script>/);
});
