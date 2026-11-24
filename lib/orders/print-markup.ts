type PrintLine = {
  id: string; media: string; marketId: string; station: string; program: string;
  format: string; days: string; start: string; end: string; rate: number | null;
  quantity: number | null; amount: number | null; impressions: number | null;
  noCharge: boolean; notes: string;
  spotsPerDay?: number | null; spotsPerWeek?: number | null; weeks?: number | null;
  audience?: number | null; cpm?: number | null; calculatedCpm?: number | null; reportedCpm?: number | null;
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
const total = (line: PrintLine) =>
  line.noCharge ? 0 : line.amount ?? (line.rate != null && line.quantity != null ? line.rate * line.quantity : null);

export function orderPdfMarkup(doc: PrintOrder, logo: string, markets: Readonly<Record<string, string>> = {}, draft = false) {
  const headers = [
    ['Order Date', doc.date], ['Media Vendor', doc.vendor, doc.rep], ['Order No.', doc.number],
    ['Terms', doc.terms], ['Client', doc.clientName], ['Buyer Contact', doc.buyer, doc.buyerEmail],
    ['Billing Contact', doc.billing],
  ];
  const flight = (line: PrintLine) => {
    const start = line.start || doc.start;
    const end = line.end || doc.end;
    return [start, end].filter(Boolean).join(' – ');
  };
  const placement = (line: PrintLine) =>
    '<strong>' + escape(line.program) + '</strong>' +
    (line.notes ? '<div class="copy">' + escape(line.notes) + '</div>' : '');
  const amounts = (line: PrintLine) =>
    '<td class="num">' + (line.noCharge ? 'No charge' : money(total(line))) + '</td>' +
    '<td class="num">' + number(line.impressions) + '</td>';
  const section = (type: 'broadcast' | 'digital') => {
    const digital = type === 'digital';
    const lines = doc.lines.filter(line => (line.media === 'Digital') === digital);
    if (!lines.length) return '';
    const label = digital ? 'DIGITAL ADS' : 'BROADCAST ADS';
    const columns = digital
      ? ['Placement / Market', 'Length', 'Run Days', 'Total Wks', 'Flight Dates', 'Total $', 'IMPs']
      : ['Channel', 'Station', 'Program Time', 'Rate', 'Spots / Day', 'Run Days', 'Spots / Wk',
        'Flight Dates', 'Total Wks', 'Total $', 'IMPs', 'Gross # Ads', 'CPM', 'Audience'];
    const rows = lines.map(line => '<tr>' + (digital
      ? '<td class="description">' + placement(line) + '<div>' + escape(markets[line.marketId] || '') + '</div></td>' +
        '<td>' + escape(line.format) + '</td><td>' + escape(line.days) + '</td><td class="num">' + number(line.weeks) +
        '</td><td>' + escape(flight(line)) + '</td>' + amounts(line)
      : '<td>' + escape(line.media) + '</td><td>' + escape(line.station) + '</td><td>' + placement(line) +
        '</td><td class="num">' + money(line.rate) + '</td><td class="num">' + number(line.spotsPerDay) +
        '</td><td>' + escape(line.days) + '</td><td class="num">' + number(line.spotsPerWeek) +
        '</td><td>' + escape(flight(line)) + '</td><td class="num">' + number(line.weeks) +
        '</td>' + amounts(line) + '<td class="num">' + number(line.quantity) +
        '</td><td class="num">' + money(line.calculatedCpm ?? line.cpm ?? line.reportedCpm) +
        '</td><td class="num">' + number(line.audience) +
        '</td>') + '</tr>').join('');
    const subtotal = lines.reduce((sum, line) => sum + (total(line) ?? 0), 0);
    const impressions = lines.reduce((sum, line) => sum + (line.impressions ?? 0), 0);
    return '<section><table><thead><tr><th class="section-title" colspan="' + columns.length + '">' + label +
      '</th></tr><tr>' + columns.map(column => '<th scope="col">' + column + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="subtotal">' + (digital ? 'DIGITAL TOTAL' : 'GROSS TOTAL') + ' &nbsp; ' + money(subtotal) +
      (impressions ? ' &nbsp; ' + number(impressions) + ' IMPs' : '') + '</div></section>';
  };
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${[draft && 'Draft', escape(doc.number), 'Media Order'].filter(Boolean).join(' · ')}</title>
<style>
@page { size: Letter; margin: .36in .36in .42in; }
* { box-sizing: border-box; }
body { margin:0; font:9pt Arial,sans-serif; color:#171717; print-color-adjust:exact; }
.mark { height:13pt; background:#c914be; }
.logo { display:block; width:183pt; height:42pt; object-fit:contain; margin:9pt auto 19pt; }
h1 { font-size:24pt; color:#d6a31d; margin:0 0 12pt; }
${draft ? '.draft { color:#555; font-size:12pt; vertical-align:middle; }\n@media screen { body { margin: 16px; } }' : ''}
.meta { display:grid; grid-template-columns:.72fr .9fr 1fr .85fr 1.2fr 1.25fr 1.2fr; gap:8pt; color:#444; }
.field { min-width:0; overflow-wrap:anywhere; }
.field strong { display:block; margin-bottom:3pt; }
.field div + div { margin-top:3pt; }
.rules { border-block:1px solid #bbb; height:12pt; margin:16pt 0 24pt; }
table { border-collapse:collapse; width:100%; font-size:8pt; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
th,td { padding:3pt 2.5pt; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
th { vertical-align:bottom; border-bottom:1px solid #111; overflow-wrap:normal; }
th.section-title { color:#d6a31d; border:0; padding-bottom:6pt; }
.num { text-align:right; white-space:nowrap; }
.description { width:39%; }
.copy { margin-top:3pt; white-space:pre-wrap; }
.subtotal { border-top:1px solid #111; color:#bc00ab; text-align:right; padding-top:5pt; margin-top:3pt; font-weight:bold; font-style:italic; break-before:avoid; }
section + section { margin-top:20pt; }
.acceptance { margin-top:24pt; break-inside:avoid; }
.acceptance p { margin:0 0 8pt; }
.signatures { display:grid; grid-template-columns:1fr .85fr; gap:36pt; margin:15pt 0 0; text-align:center; }
.signature { border:1px solid #111; height:29pt; margin-bottom:3pt; }
</style>
<div class="mark"></div><img class="logo" src="${escape(logo)}" alt="Final Fore Media"><h1>Media Order${draft ? ' <span class="draft">Draft</span>' : ''}</h1>
<div class="meta">${headers.map(([label, ...values]) => '<div class="field"><strong>' + label + '</strong>' +
  values.map(value => '<div>' + escape(value) + '</div>').join('') + '</div>').join('')}</div>
<div class="rules"></div>${section('broadcast')}${section('digital')}
<footer class="acceptance">${doc.notes ? '<p class="copy">' + escape(doc.notes) + '</p>' : ''}
${draft ? '' : `<p>Please sign and date below. By signing this Final Fore Media Order, the media company's representative acknowledges and accepts the order and its terms.</p>
<div class="signatures"><div><div class="signature"></div>Signature</div><div><div class="signature"></div>Date</div></div>`}
</footer></html>`;
}
