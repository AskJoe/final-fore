import assert from 'node:assert/strict';
import test from 'node:test';
import { initial } from '../lib/domain/directory';
import type { ArchiveFile, ArchiveLine, ArchiveRecord, OrderArchive } from '../lib/orders/archive-source';
import { archiveOrderSeed } from '../lib/orders/sources';
import { orderTotal } from '../lib/orders/store';

const clientId = 'epic3';
const marketId = 'epic3-austin';
const market = 'Austin';
const placement = (row: number, medium: string, name: string, amount: number): ArchiveLine => ({
  row, medium, placement: name, amount, tab: medium, flight: '2/27/26-5/22/26', kind: 'Placement',
  station: medium === 'Radio' ? 'KKMJ-FM' : '', rate: '', spots: '', days: 'M-F', weeks: '12',
  note: '', area: '', client: '', fmt: ':30', context: '', impressions: '',
});
const streaming = placement(2, 'Digital', 'Digital Streaming Radio', 3000);
const record = (source: string, type: string, lines: ArchiveLine[]): ArchiveRecord => ({
  id: source, source, type, market, name: type, issued: '', ref: 'Austin-26', client: 'EPIC3',
  media: 'Radio, Digital', amount: 0, basis: '', imps: '', targets: [], lines, version: '',
  signed: source, signedOn: '2026-02-02', signedBy: '', note: '', related: [],
});
const file = (id: string): ArchiveFile => ({
  id, name: id, kind: 'Signed order', url: 'https://drive.google.com/file/d/' + id + '/view',
  market, marketId, signedOn: '2026-02-02', revision: '', rep: '', firm: 'iHeart', changed: '',
});

test('the default market template includes Digital, the net fee, and each vendor placement once', () => {
  const archive: OrderArchive = {
    version: 1, year: 2026, marketIds: { [market]: marketId }, coverageYear: null, coverage: [],
    files: { market: file('market'), vendor: file('vendor') },
    orders: [record('market', 'Market purchase order', [
      placement(1, 'Radio', 'Radio spots', 39025), streaming,
      placement(3, 'Digital', 'OTT & PreRoll', 6800), placement(4, 'Digital', 'Display ads', 26000),
      { ...placement(5, 'Digital', 'Net OTT', 5750), net: '5000', fee: '15%' },
    ]), record('vendor', 'Vendor order', [streaming])],
  };

  const template = archiveOrderSeed(archive, initial(), {
    clientId, year: 2027, marketIds: [marketId], workflow: 'broadcast', archiveId: '',
  });

  assert.equal(template.lines.filter(line => line.media === 'Radio').length, 1);
  const digital = template.lines.filter(line => line.media === 'Digital');
  assert.equal(digital.length, 4);
  assert.equal(digital.find(line => line.program === 'Net OTT')?.feeBasisPoints, 1500);
  assert.ok(digital.every(line => line.marketId === marketId && line.source?.year === 2026 && !line.start && !line.end));
  assert.equal(orderTotal({ ...template.header, lines: template.lines }), 8057500);
});
