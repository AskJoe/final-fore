import originalTemplate from '../../epic3/order-template.json';
import type { OrderLine } from './store';
import { orderLineCharges } from './metrics';
import { orderVendorGroups, orderVendorLabel } from './vendor-groups';

type PrintLine = {
  id: string; media: string; marketId: string; station: string; program: string;
  format: string; days: string; start: string; end: string; rate: number | null;
  quantity: number | null; amount: number | null; impressions: number | null;
  noCharge: boolean; notes: string; feeBasisPoints?: number | null;
  spotsPerDay?: number | null; spotsPerWeek?: number | null; weeks?: number | null;
  audience?: number | null; cpm?: number | null; calculatedCpm?: number | null; reportedCpm?: number | null;
  priorFlight?: string;
  source?: OrderLine['source'];
};

export type PrintOrder = {
  number: string; date: string; clientName: string; vendor: string; rep: string;
  buyer: string; buyerEmail: string; billing: string; terms: string;
  start: string; end: string; notes: string; lines: PrintLine[];
};

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, char => entities[char]);
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (v: number | null | undefined) => v == null ? '' : currency.format(v / 100);
const number = (v: number | null | undefined) => v == null ? '' : v.toLocaleString('en-US');
const total = (line: PrintLine) => orderLineCharges(line).due;

export function orderPdfMarkup(doc: PrintOrder, logo: string, markets: Readonly<Record<string, string>> = {}, draft = false, clientOrder = false) {
  const orderMarkets = [...new Set(doc.lines.map(line => markets[line.marketId]).filter(Boolean))];
  const headers = [
    ['Order Date', doc.date], ...(!clientOrder ? [['Media Vendor', doc.vendor, doc.rep]] : []), ['Order No.', doc.number],
    ['Terms', doc.terms], ['Client', doc.clientName], ['Buyer Contact', doc.buyer, doc.buyerEmail],
    ['Billing Contact', doc.billing],
  ];
  const flight = (line: PrintLine) => {
    const dates = [line.start || doc.start, line.end || doc.end].filter(Boolean);
    if (dates.length) return dates.map(date => '<span class="flight-date">' + escape(date) + '</span>').join('');
    return draft && line.priorFlight ? '<small>Prior flight</small>' + escape(line.priorFlight) : '';
  };
  const placement = (line: PrintLine) =>
    '<strong>' + escape(line.program) + '</strong>' +
    (line.notes && line.notes !== originalTemplate.stationNote
      ? '<div class="copy">' + (line.source?.kind === 'historical' ? 'Sample note · ' : '') + escape(line.notes) + '</div>' : '');
  const amounts = (line: PrintLine) =>
    '<td class="num">' + (line.noCharge ? 'No charge' : money(total(line))) + '</td>' +
    '<td class="num">' + number(line.impressions) + '</td>';
  const section = (type: 'broadcast' | 'digital' | 'net') => {
    const digital = type !== 'broadcast';
    const net = type === 'net';
    const lines = doc.lines.filter(line => digital
      ? line.media === 'Digital' && (line.feeBasisPoints != null) === net : line.media !== 'Digital');
    if (!lines.length) return '';
    const label = net ? 'NET DIGITAL ADS' : digital ? 'DIGITAL ADS' : 'BROADCAST ADS';
    const columns = digital
      ? ['Placement / Market', 'Length', 'Run Days', 'Total Wks', 'Flight Dates',
        ...(net ? ['Net media', 'Management fee', 'Amount due'] : ['Total $']), 'IMPs']
      : ['Station / channel', 'Placement / program', 'Rate', 'Schedule', 'Flight', 'Spots', 'Total $', 'Imps', 'CPM', 'Audience'];
    const schedule = (line: PrintLine) => {
      const days = [line.days, line.weeks == null ? '' : number(line.weeks) + ' wks'];
      const spots = [line.spotsPerDay == null ? '' : number(line.spotsPerDay) + '/day',
        line.spotsPerWeek == null ? '' : number(line.spotsPerWeek) + '/wk'];
      return [days, spots].map(values => values.filter(Boolean).map(escape).join(' · ')).filter(Boolean).join('<br>');
    };
    const netAmounts = (line: PrintLine) => {
      const { media, fee, due } = orderLineCharges(line);
      return '<td class="num">' + money(media) + '</td><td class="num">' + money(fee) +
        '<small>' + number((line.feeBasisPoints ?? 0) / 100) + '%</small></td><td class="num">' +
        (line.noCharge ? 'No charge' : money(due)) + '</td><td class="num">' + number(line.impressions) + '</td>';
    };
    const renderRow = (line: PrintLine) => '<tr>' + (digital
      ? '<td class="description">' + placement(line) + '<div>' + escape(markets[line.marketId] || '') + '</div></td>' +
        '<td>' + escape(line.format) + '</td><td>' + escape(line.days) + '</td><td class="num">' + number(line.weeks) +
        '</td><td>' + flight(line) + '</td>' + (net ? netAmounts(line) : amounts(line))
      : '<td><strong>' + escape(line.station) + '</strong><small>' + escape(line.media) + '</small></td><td>' +
        placement(line) + '<small>' + escape(line.format) + '</small></td><td class="num">' + money(line.rate) +
        '</td><td>' + schedule(line) + '</td><td>' + flight(line) + '</td><td class="num">' + number(line.quantity) +
        '</td>' + amounts(line) +
        '<td class="num">' + money(line.calculatedCpm ?? line.cpm ?? line.reportedCpm) +
        '</td><td class="num">' + number(line.audience) +
        '</td>') + '</tr>';
    const groups = orderVendorGroups(lines, line => line);
    const rows = groups.map(group => (group.vendor || group.rep || groups.length > 1
      ? '<tr class="vendor"><th colspan="' + columns.length + '">' + escape(orderVendorLabel(group)) + '</th></tr>' : '') +
      group.items.map(renderRow).join('')).join('');
    const subtotal = lines.reduce((sum, line) => sum + (total(line) ?? 0), 0);
    const impressions = lines.reduce((sum, line) => sum + (line.impressions ?? 0), 0);
    return '<section class="schedule"><table><thead><tr><th class="section-title" colspan="' + columns.length + '">' + label +
      '</th></tr><tr>' + columns.map(column => '<th scope="col">' + column + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="subtotal">' + (net ? 'NET DIGITAL TOTAL DUE' : digital ? 'DIGITAL TOTAL' : 'BROADCAST TOTAL') + ' &nbsp; ' + money(subtotal) +
      (impressions ? ' &nbsp; ' + number(impressions) + ' IMPs' : '') + '</div></section>';
  };
  const amountDue = doc.lines.reduce((sum, line) => sum + (total(line) ?? 0), 0);
  const knownImpressions = doc.lines.reduce((sum, line) => sum + (line.impressions ?? 0), 0);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${[draft && 'Draft', escape(doc.number), 'Media Order'].filter(Boolean).join(' · ')}</title>
<style>
@page { size: Letter; margin: .42in .18in; }
* { box-sizing: border-box; }
body { margin:0; padding:.38in .38in .32in; font:9pt/1.35 Arial,sans-serif; color:#171717; print-color-adjust:exact; }
.mark { height:5pt; background:#c914be; }
.logo { display:block; width:183pt; height:42pt; object-fit:contain; margin:12pt auto 12pt; }
h1 { font-size:23pt; color:#91660d; margin:0 0 12pt; }
.order-market { font-weight:700; margin:-7pt 0 10pt; }
.draft { color:#555; font-size:12pt; vertical-align:middle; }
.meta { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10pt 12pt; color:#444; padding-block:1pt 12pt; border-bottom:1px solid #bbb; }
.field.contact { grid-column:span 2; }
.field { min-width:0; overflow-wrap:anywhere; }
.field strong { display:block; margin-bottom:3pt; }
.field div + div { margin-top:3pt; }
.schedule { margin-top:14pt; }
table { border-collapse:collapse; width:100%; font-size:8pt; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
th,td { padding:4pt 3pt; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
th { vertical-align:bottom; border-bottom:1px solid #111; overflow-wrap:normal; }
td { border-bottom:1px solid #ddd; }
td small { display:block; color:#555; }
th.section-title { color:#91660d; border:0; padding-bottom:7pt; }
.vendor { break-after:avoid; }
.vendor th { border-bottom:1px solid #999; background:#f2f2f2; }
.num { text-align:right; white-space:nowrap; }
.flight-date { display:block; white-space:nowrap; }
.description { width:39%; }
.copy { margin-top:3pt; white-space:pre-wrap; }
.subtotal { border-top:1px solid #111; color:#bc00ab; text-align:right; padding-top:5pt; margin-top:3pt; font-weight:bold; font-style:italic; break-before:avoid; }
.notes { margin-top:17pt; }
.notes h2 { font-size:10pt; margin:0 0 4pt; break-after:avoid; }
.note-space { border:1px solid #aaa; min-height:40pt; padding:6pt 8pt; margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.sample-notes { break-inside:avoid; }
.sample-notes ul { padding-inline-start:15pt; margin:0; }
.acceptance { margin-top:18pt; break-inside:avoid; }
.acceptance p { margin:0 0 8pt; }
.signatures { display:grid; grid-template-columns:1fr .85fr; gap:36pt; margin:15pt 0 0; text-align:center; }
.signature { border:1px solid #111; height:29pt; margin-bottom:3pt; }
</style>
<div class="mark"></div><img class="logo" src="${escape(logo)}" alt="Final Fore Media"><h1>Media Order${draft ? ' <span class="draft">Draft</span>' : ''}</h1>
${orderMarkets.length ? '<p class="order-market">' + escape(orderMarkets.join(' · ')) + '</p>' : ''}
<div class="meta">${headers.map(([label, ...values]) => '<div class="field' + (label === 'Buyer Contact' ? ' contact' : '') + '"><strong>' + label + '</strong>' +
  values.map(value => '<div>' + escape(value) + '</div>').join('') + '</div>').join('')}</div>
${section('broadcast')}${section('digital')}${section('net')}
<div class="subtotal">TOTAL DUE &nbsp; ${money(amountDue)}${knownImpressions ? ' &nbsp; ' + number(knownImpressions) + ' IMPs' : ''}</div>
<section class="notes"><h2>Order notes</h2><p class="note-space">${escape(doc.notes)}</p></section>
${doc.lines.some(line => line.media !== 'Digital') ? `<section class="notes sample-notes"><h2>Sample notes</h2>
<ul><li>${escape(originalTemplate.rateNote.trim())}</li><li>${escape(originalTemplate.stationNote)}</li></ul></section>` : ''}
${draft ? '' : `<footer class="acceptance">
<p>Please sign and date below. By signing this Final Fore Media Order, the ${clientOrder ? 'client’s' : 'media company’s'} representative acknowledges and accepts the order and its terms.</p>
<div class="signatures"><div><div class="signature"></div>Signature</div><div><div class="signature"></div>Date</div></div>
</footer>`}</html>`;
}
