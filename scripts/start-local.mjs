/** Starts this project's real local Supabase stack and Next.js. Never imports or resets data. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import net from 'node:net';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
assert.match(fs.readFileSync('supabase/config.toml','utf8'),/project_id = "final-fore-local"/);
const config=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
assert.equal(config.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321','Local startup refuses nonlocal Supabase URLs.');
// Refuse an occupied app port before starting backend work or rebuilding files.
// Next.js also binds this explicit port and fails if it becomes occupied later.
if(!process.argv.includes('--backend-only'))await new Promise((resolve,reject)=>{
 const probe=net.createServer();
 probe.once('error',error=>reject(new Error('Final Fore requires free port 3107. No existing service was stopped. '+error.message)));
 probe.listen({host:'127.0.0.1',port:3107,exclusive:true},()=>probe.close(error=>error?reject(error):resolve()));
});
const env={...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1',NEXT_TELEMETRY_DISABLED:'1',FINAL_FORE_TEST_BUILD:'0'};
const network='final-fore-local-network';
const networks=execFileSync('docker',['--context','desktop-linux','network','ls','--format','{{.Name}}'],{encoding:'utf8',env}).trim().split('\n');
if(!networks.includes(network))execFileSync('docker',['--context','desktop-linux','network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network],{env});
fs.mkdirSync('.local-migration',{recursive:true});
const started=spawnSync('supabase',['start','--network-id',network],{env,encoding:'utf8',maxBuffer:16*1024*1024});
fs.writeFileSync('.local-migration/local-start.log',(started.stdout??'')+(started.stderr??''),{mode:0o600});
if(started.error)throw started.error;
if(started.status!==0)throw Error('Local Supabase did not start. See .local-migration/local-start.log; no fallback was used.');
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{env,encoding:'utf8'}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
console.log('Real local Supabase ready at '+status.API_URL+'. PostgreSQL data persists in Docker volumes.');
if(!process.argv.includes('--backend-only')){
 const appEnv={...env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.PUBLISHABLE_KEY||status.ANON_KEY};
 const build=spawnSync('npm',['run','build'],{env:appEnv,stdio:'inherit'});
 if(build.error)throw build.error;if(build.status!==0)throw Error('Next.js build failed; app was not started.');
 const app=spawn('npm',['start'],{env:appEnv,stdio:'inherit'});
 app.on('error',error=>{console.error(error);process.exitCode=1;});
 app.on('exit',(code)=>{process.exitCode=code??0;});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.kill(signal));
}
