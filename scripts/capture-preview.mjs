// One-time read-only capture of the running mock, before switching to real Supabase.
import fs from 'node:fs';
import crypto from 'node:crypto';
const base='http://127.0.0.1:54329';
const auth=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:'local-test-key'},body:JSON.stringify({email:'owner@example.test',password:'local-test-password'})});
if(!auth.ok)throw Error('Local preview authentication failed: '+auth.status);
const session=await auth.json();
const response=await fetch(base+'/rest/v1/ff_records?select=*',{headers:{apikey:'local-test-key',authorization:'Bearer '+session.access_token}});
if(!response.ok)throw Error('Local preview export failed: '+response.status);
const records=await response.json();
if(!Array.isArray(records)||!records.some(r=>r.id==='workbook'))throw Error('Incomplete local preview export');
const content=JSON.stringify(records),file='.local-migration/backups/live-preview-'+new Date().toISOString().replaceAll(':','-')+'.json';
fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
fs.writeFileSync('.local-migration/preserved-preview.json',content,{mode:0o600});
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const statements=['-- Local-only import from the captured preview. Plain INSERT refuses existing IDs.','begin;','set local standard_conforming_strings = on;'];
for(const r of records){
 if(!Number.isSafeInteger(r.version)||r.version<1)throw Error('Invalid source record version');
 statements.push(`insert into public.ff_records(id,kind,version,payload,updated_at) values (${quote(r.id)},${quote(r.kind)},${r.version},${quote(JSON.stringify(r.payload))}::jsonb,${quote(r.updated_at)}::timestamptz);`);
}
statements.push('commit;');
fs.writeFileSync('.local-migration/preserved-preview.sql',statements.join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({file,records:records.length,sha256:crypto.createHash('sha256').update(content).digest('hex')},null,2));
