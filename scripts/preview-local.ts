// Compatibility entry point: interactive local use now always starts real Supabase.
// The in-memory fixture is used only by the isolated automated browser tests.
import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['scripts/start-local.mjs'],{stdio:'inherit',env:process.env});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>child.kill(signal));
