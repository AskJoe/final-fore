// Read-only completion of the authorized local migration verification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

assert.match(fs.readFileSync('supabase/config.toml','utf8'),/^project_id = "final-fore-local"$/m);
const advisor=spawnSync('supabase',['db','advisors','--local','--type','security','--level','warn','-o','json'],{
  env:{...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1'},encoding:'utf8',maxBuffer:8*1024*1024,
});
if(advisor.error)throw advisor.error;
fs.writeFileSync('.local-migration/directory-security-advisors.log',advisor.stdout+advisor.stderr,{mode:0o600});
assert.equal(advisor.status,0,advisor.stderr);
// CLI 2.90 emits no JSON when it reports "No issues found" on stderr.
// Accept that documented observation only; unexpected empty output still fails.
const stdout=advisor.stdout.trim();
const advisory=stdout?{format:'json',findings:JSON.parse(stdout)}:{format:'empty-json-with-explicit-status',message:'No issues found'};
if(!stdout)assert.match(advisor.stderr,/(?:^|\n)No issues found(?:\r?\n|$)/);
fs.writeFileSync('.local-migration/directory-security-advisors.json',JSON.stringify({checkedAt:new Date().toISOString(),exitCode:advisor.status,...advisory},null,2),{mode:0o600});
console.log(stdout?'PASS advisor JSON report captured':'PASS security advisor: No issues found; empty JSON output handled explicitly');

const query=sql=>{
  const result=spawnSync('docker',['--context','desktop-linux','exec','supabase_db_final-fore-local','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
const before=JSON.parse(fs.readFileSync('.local-migration/directory-before-record-digests.json','utf8'));
const after=query("select coalesce(json_agg(json_build_object('id',id,'kind',kind,'version',version,'digest',md5(row_to_json(r)::text)) order by id),'[]'::json) from public.ff_records r");
fs.writeFileSync('.local-migration/directory-after-record-digests.json',JSON.stringify(after,null,2),{mode:0o600});
for(const original of before)assert.deepEqual(after.find(row=>row.id===original.id),original,'Existing record changed: '+original.id);
const added=after.filter(row=>!before.some(original=>original.id===row.id));
assert.deepEqual(added.map(row=>({id:row.id,kind:row.kind})),[{id:'directory',kind:'directory'}]);
assert.equal(after.length,before.length+1);
const directory=query("select row_to_json(r) from public.ff_records r where id='directory'");
const baseline=JSON.parse(fs.readFileSync('.local-migration/directory-before-verification.json','utf8'));
const verification=JSON.parse(fs.readFileSync('.local-migration/real-directory-verification.json','utf8'));
assert.deepEqual(directory.payload,baseline.initial.directory);
assert.equal(directory.version,verification.recordVersion);
const result={verifiedAt:new Date().toISOString(),existingRecordsCompared:before.length,existingRecordsUnchanged:true,addedRecordIds:added.map(row=>row.id),directoryVersion:directory.version,originalDirectoryValuesPreserved:true,counts:Object.fromEntries(Object.entries(directory.payload).map(([key,rows])=>[key,rows.length]))};
fs.writeFileSync('.local-migration/directory-record-comparison.json',JSON.stringify(result,null,2),{mode:0o600});
console.log(`PASS all ${before.length} pre-existing records unchanged, including payloads, versions, and timestamps`);
console.log(`PASS only directory added; version ${directory.version}; original reference values preserved; no dummy entries`);
console.log(JSON.stringify(result.counts));
