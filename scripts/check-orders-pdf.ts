import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { initial } from '../lib/domain/directory';
import { MARKETS } from '../lib/domain/catalogs';
import { archiveOrderSeed, loadOrderArchive, orderOpportunities, type OrderOpportunity } from '../lib/orders/sources';
import type { ArchiveRecord } from '../lib/orders/archive-source';
import { orderTotal, type OrderDocument } from '../lib/orders/store';
import { renderOrderPdf } from '../lib/orders/pdf';

async function main() {
  const archive = await loadOrderArchive();
  assert.ok(archive, 'Set FINAL_FORE_ORDER_ARCHIVE_PATH to the locally reviewed manifest.');
  const directory = initial();
  const scope = {clientId:'epic3',year:2027};
  const opportunities = orderOpportunities(archive,directory,scope);
  const markets = Object.fromEntries(Object.entries(MARKETS).map(([key,value])=>[key,String(value.name)]));

  for (const fixture of [
    {file:'200',name:'weather',rows:20,total:15_434_000,label:'DIGITAL ADS',money:'$154,340.00'},
    {file:'210',name:'kigl',rows:6,total:2_613_200,label:'BROADCAST ADS',money:'$23,700.00'},
  ]) {
    const source: ArchiveRecord|undefined = archive.orders.find(order => order.source === fixture.file);
    const opportunity: OrderOpportunity|undefined = opportunities.find(candidate => candidate.archiveId === source?.id);
    assert.ok(opportunity, 'Missing order opportunity for ' + fixture.name);
    const {header,lines} = archiveOrderSeed(archive,directory,{
      ...scope,archiveId:opportunity.archiveId!,marketIds:opportunity.marketIds,workflow:opportunity.workflow,
    });
    assert.equal(lines.length,fixture.rows);
    const document: OrderDocument = {
      ...header,number:'LOCAL-PDF-CHECK-'+fixture.name.toUpperCase(),date:'2027-01-02',
      start:'2027-02-01',end:'2027-05-31',lines,
    };
    assert.equal(orderTotal(document),fixture.total);
    const pdf = await renderOrderPdf(document,markets);
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    await fs.mkdir('.local-migration/order-pdf-checks',{recursive:true});
    const output = '.local-migration/order-pdf-checks/'+fixture.name+'.pdf';
    await fs.writeFile(output,pdf,{mode:0o600});
    const text = execFileSync('pdftotext',['-layout',output,'-'],{encoding:'utf8'});
    assert.ok(text.includes(fixture.label));
    assert.ok(text.includes(fixture.money));
    assert.ok(text.includes('Signature'));
    if (fixture.name === 'weather') assert.ok(text.split('DIGITAL ADS').length > 2,'Expected a repeated heading on the second page.');
    console.log(fixture.name + ': ' + fixture.rows + ' placements, expected total, and signature footer in generated PDF');
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
