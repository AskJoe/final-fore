import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const cwd=process.cwd(),root=path.join(cwd,'.local-migration/clamav'),agents=path.join(os.homedir(),'Library/LaunchAgents');
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const list=process.argv.includes('--worker-only')?[['uploads',[process.execPath,path.join(cwd,'node_modules/tsx/dist/cli.mjs'),path.join(cwd,'scripts/research-upload-worker.ts')]]]:[['clamd',['/opt/homebrew/sbin/clamd','--config-file='+path.join(root,'clamd.conf')]],['freshclam',['/opt/homebrew/bin/freshclam','--config-file='+path.join(root,'freshclam.conf'),'--daemon','--foreground']]];
fs.mkdirSync(agents,{recursive:true});
for(const [name,args] of list){const label='com.finalfore.research.'+name,file=path.join(agents,label+'.plist');if(fs.existsSync(file))throw new Error('Service already exists; no restart performed: '+label);
fs.writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>WorkingDirectory</key><string>${xml(cwd)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(root+'/'+name+'.log')}</string><key>StandardErrorPath</key><string>${xml(root+'/'+name+'.log')}</string></dict></plist>`,{mode:0o600});
execFileSync('launchctl',['bootstrap','gui/'+process.getuid(),file],{stdio:'inherit'});console.log('Started supervised local service '+label);
}
