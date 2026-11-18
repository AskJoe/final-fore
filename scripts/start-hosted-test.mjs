// Keep hosted sends in test mode unless the operator explicitly enables live delivery.
import {spawn} from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const env={...process.env,FINAL_FORE_TEST_BUILD:'0',FINAL_FORE_RESEARCH_TEST_ONLY:process.env.FINAL_FORE_RESEARCH_TEST_ONLY==='0'?'0':'1',FINAL_FORE_RESEARCH_FROM:'sarah@finalforemedia.com',FINAL_FORE_RESEARCH_SARAH_EMAIL:'sarah@finalforemedia.com',NEXT_TELEMETRY_DISABLED:'1'};
const bundledSoffice = fileURLToPath(new URL('../.render/libreoffice/soffice', import.meta.url));
if (!env.FINAL_FORE_SOFFICE_PATH && existsSync(bundledSoffice)) env.FINAL_FORE_SOFFICE_PATH = bundledSoffice;

let worker;
let workerRestart;
let stopping = false;
const web = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', env.PORT || '3000',
], { env, stdio: 'inherit' });

function stop(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(workerRestart);
  process.exitCode = code;
  web.kill('SIGTERM');
  worker?.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1_000).unref();
}
web.once('error', () => stop(1));
web.once('close', code => stop(code || 1));

function startWorker() {
  worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/research-worker.ts', '--watch'], { env, stdio: 'inherit' });
  worker.once('error', error => console.error('Research worker failed to start:', error.message));
  worker.once('close', (code, signal) => {
    worker = undefined;
    if (stopping || code === 0) return;
    console.error('Research worker stopped (%s). Restarting the worker in 10 seconds.', signal ?? code);
    workerRestart = setTimeout(startWorker, 10_000);
  });
}

if (env.FINAL_FORE_RESEARCH_SEND_ENABLED === '1') {
  if (env.RESEND_API_KEY) startWorker();
  else console.error('Research worker disabled: sending requires the Resend API key.');
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
