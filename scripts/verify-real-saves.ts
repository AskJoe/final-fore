// Exercises each mutable record kind against the real local database without changing payload values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStore } from '../lib/store';

async function main() {
  const status=JSON.parse(fs.readFileSync('.local-migration/local-supabase-status.json','utf8'));
  assert.equal(status.API_URL,'http://127.0.0.1:54321');
  const db=createClient(status.API_URL,status.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await db.auth.signInWithPassword({email:'owner@example.test',password:'local-test-password'});
  if(login.error)throw login.error;
  const store=new SupabaseStore(db), results=[];
  for(const kind of ['workbook','campaign','campaign_order']) {
    const record=(await store.list(kind))[0];assert.ok(record,kind);
    await store.save(record.id,kind,record.payload,record.version);
    const saved=await store.get(record.id);assert.ok(saved);
    assert.deepEqual(saved.payload,record.payload);
    assert.equal(saved.version,record.version+1);
    results.push({kind,id:record.id,versionBefore:record.version,versionAfter:saved.version,payloadUnchanged:true});
    console.log(`PASS real ${kind} save: PostgreSQL version ${record.version} → ${saved.version}; payload preserved.`);
  }
  fs.writeFileSync('.local-migration/real-save-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),results},null,2),{mode:0o600});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
