// Hosted pilot entrypoint. Vendor sending cannot be enabled through this launcher.
import {spawn} from 'node:child_process';
const env={...process.env,FINAL_FORE_TEST_BUILD:'0',FINAL_FORE_RESEARCH_TEST_ONLY:'1',FINAL_FORE_RESEARCH_FROM:'sarah@finalforemedia.com',FINAL_FORE_RESEARCH_SARAH_EMAIL:'sarah@finalforemedia.com',NEXT_TELEMETRY_DISABLED:'1'};
const children=[];
let stopping=false;
function stop(code){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),1000).unref();}
function start(args){const child=spawn(process.execPath,args,{env,stdio:'inherit'});children.push(child);child.on('error',()=>stop(1));child.on('exit',code=>stop(code||1));}
start(['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000']);
if(env.FINAL_FORE_RESEARCH_SEND_ENABLED==='1'){
  if(!env.RESEND_API_KEY){console.error('Test sending requires the Resend API key.');stop(1);}
  else start(['--import','tsx','scripts/research-worker.ts','--watch']);
}
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));
