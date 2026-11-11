/** Produces SQL for review. This script has no network code and never applies SQL. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { orderKey,campaignKey } from '../lib/service';
const root='.local-migration';
const read=(name:string)=>JSON.parse(fs.readFileSync(`${root}/${name}.json`,'utf8'));
const manifest=read('manifest');
for(const [file,hash] of Object.entries(manifest.sha256)) {
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw new Error(`Source changed since export: ${file}. Export again before preparing an import.`);
}
const sql=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const records:any[]=[{id:'workbook',kind:'workbook',payload:read('workbook')}];
for(const c of read('campaigns'))records.push({id:campaignKey(c.id),kind:'campaign',payload:{...c.details,id:c.id,revision:c.revision},updatedAt:c.updated_at});
for(const o of read('campaign-orders'))records.push({id:orderKey(o.campaign_id,o.market_id),kind:'campaign_order',payload:{revision:o.revision,source:o.source,details:o.details},updatedAt:o.updated_at});
const reportFile='epic3/reporting/web/reporting-data.json';
const {records:reportRows,...snapshot}=JSON.parse(fs.readFileSync(reportFile,'utf8'));
const chunkSize=5000,chunkCount=Math.ceil(reportRows.length/chunkSize);
records.push({id:'reporting',kind:'report_manifest',payload:{snapshot,recordCount:reportRows.length,chunkCount}});
for(let i=0;i<chunkCount;i++)records.push({id:`reporting:${String(i).padStart(5,'0')}`,kind:'report_chunk',payload:{records:reportRows.slice(i*chunkSize,(i+1)*chunkSize)}});
const statements=['-- REVIEW ONLY: contains private plan/order/reporting data. Never commit or upload without approval.','-- Plain INSERT intentionally refuses to overwrite existing records. Entire import is transactional.','begin;'];
for(const r of records)statements.push(`insert into public.ff_records(id,kind,version,payload,updated_at) values (${sql(r.id)},${sql(r.kind)},1,${sql(JSON.stringify(r.payload))}::jsonb,${r.updatedAt?sql(r.updatedAt)+'::timestamptz':'now()'});`);
statements.push('commit;');
fs.writeFileSync(`${root}/import.sql`,statements.join('\n')+'\n');
fs.writeFileSync(`${root}/records.json`,JSON.stringify(records));
const summary={records:records.length,reportingRows:reportRows.length,reportChunks:chunkCount,sqlBytes:fs.statSync(`${root}/import.sql`).size,sourceHashes:manifest.sha256,reportingSha256:crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'),sqlSha256:crypto.createHash('sha256').update(fs.readFileSync(`${root}/import.sql`)).digest('hex')};
fs.writeFileSync(`${root}/import-summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
