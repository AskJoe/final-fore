// Local-only provisioning; refuses any URL other than this project's loopback API.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const status=JSON.parse(fs.readFileSync('.local-migration/local-supabase-status.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(fs.readFileSync('supabase/config.toml','utf8'),/project_id = "final-fore-local"/);
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const list=await admin.auth.admin.listUsers();if(list.error)throw list.error;
const email='owner@example.test';let user=list.data.users.find(u=>u.email===email);
if(!user){const created=await admin.auth.admin.createUser({email,password:'local-test-password',email_confirm:true});if(created.error)throw created.error;user=created.data.user;}
assert.ok(user);
const membership=await admin.from('ff_members').select('user_id').eq('user_id',user.id).maybeSingle();if(membership.error)throw membership.error;
if(!membership.data){const added=await admin.from('ff_members').insert({user_id:user.id});if(added.error)throw added.error;}
const actual=await admin.from('ff_records').select('*').order('id');if(actual.error)throw actual.error;
const expected=JSON.parse(fs.readFileSync('.local-migration/preserved-preview.json','utf8')).sort((a,b)=>a.id.localeCompare(b.id));
assert.equal(actual.data.length,expected.length);
for(const source of expected){const target=actual.data.find(r=>r.id===source.id);assert.ok(target);assert.equal(target.kind,source.kind);assert.equal(target.version,source.version);assert.deepEqual(target.payload,source.payload);assert.equal(Date.parse(target.updated_at),Date.parse(source.updated_at));}
const backup='.local-migration/backups/environment-before-local-'+new Date().toISOString().replaceAll(':','-')+'.env';
if(fs.existsSync('.env.local'))fs.copyFileSync('.env.local',backup,fs.constants.COPYFILE_EXCL);
fs.writeFileSync('.env.local',`NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY||status.ANON_KEY}\n`,{mode:0o600});
fs.writeFileSync('.local-migration/local-owner.json',JSON.stringify({id:user.id,email},null,2),{mode:0o600});
fs.writeFileSync('.local-migration/import-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),records:expected.length,payloadsExact:true,versionsExact:true,timestampsExact:true,ownerId:user.id,api:status.API_URL},null,2));
console.log(JSON.stringify({api:status.API_URL,ownerEmail:email,ownerId:user.id,recordsPreserved:expected.length,payloadsExact:true,versionsExact:true,timestampsExact:true},null,2));
