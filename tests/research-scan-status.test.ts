import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {scanWithClamAv} from '../lib/research/clamav';
import {uploadStatus} from '../lib/research/file-status';
test('expired checking is an explicit failure even when the worker is down',()=>{
 assert.deepEqual(uploadStatus({state:'checking',error:null,check_deadline:'2026-11-11T12:00:00Z'},Date.parse('2026-11-11T12:01:00Z')),{state:'failed',error:'Upload verification timed out. Please upload this file again.'});
 assert.equal(uploadStatus({state:'ready',error:null,check_deadline:'2020-01-01'},Date.now()).state,'ready');
 assert.equal(uploadStatus({state:'checking',error:null,check_deadline:new Date(Date.now()+10000).toISOString()}).state,'checking');
});
async function scanner(reply:string,version='ClamAV 1.5.4/28180/'+new Date().toUTCString()){
 const socketPath=path.join(os.tmpdir(),'ff-scan-'+randomUUID()+'.sock');const server=net.createServer(s=>{s.once('data',b=>{if(b.toString().startsWith('zVERSION'))s.end(version+'\0');else s.end(reply+'\0');});});
 await new Promise<void>(r=>server.listen(socketPath,r));return {socketPath,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
test('scanner only accepts explicit clean and rejects malformed or stale responses',async()=>{
 for(const [reply,expected] of [['stream: OK',true],['stream: Eicar-Signature FOUND',false]] as const){const s=await scanner(reply);try{assert.equal(await scanWithClamAv(Buffer.from('test'),s.socketPath),expected);}finally{await s.close();}}
 const invalid=await scanner('scanner failed');try{await assert.rejects(scanWithClamAv(Buffer.from('test'),invalid.socketPath),/did not complete/);}finally{await invalid.close();}
 const stale=await scanner('stream: OK','ClamAV 1.5.4/1/Jan 01 2000');try{await assert.rejects(scanWithClamAv(Buffer.from('test'),stale.socketPath),/definitions/);}finally{await stale.close();}
});
