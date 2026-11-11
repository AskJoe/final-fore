import net from 'node:net';
import {once} from 'node:events';
/** Local Unix socket only: document bytes never leave this computer. */
async function command(socketPath:string,command:string,bytes?:Buffer,timeoutMs=60000):Promise<string>{
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({path:socketPath});let output='',settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(output.replace(/\0.*$/s,'').trim());};
    const timer=setTimeout(()=>finish(new Error('Security scan timed out.')),timeoutMs);
    socket.on('error',e=>finish(e));socket.on('end',()=>output.includes('\0')?finish():finish(new Error('Scanner returned an incomplete result.')));
    socket.on('data',chunk=>{output+=chunk.toString();if(output.length>8192)finish(new Error('Invalid scanner response.'));else if(output.includes('\0'))finish();});
    socket.on('connect',()=>{void(async()=>{socket.write('z'+command+'\0');if(bytes){for(let at=0;at<bytes.length;at+=65536){const chunk=bytes.subarray(at,at+65536),length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);if(!socket.write(Buffer.concat([length,chunk])))await once(socket,'drain');}socket.write(Buffer.alloc(4));}})().catch(e=>finish(e));});
  });
}
export async function scanWithClamAv(bytes:Buffer,socketPath=process.env.FINAL_FORE_RESEARCH_CLAMD_SOCKET??''){
  if(!socketPath.startsWith('/'))throw new Error('Local security scanner is not configured.');
  const version=await command(socketPath,'VERSION',undefined,5000),date=Date.parse(version.split('/').at(-1)??'');
  if(!Number.isFinite(date)||date>Date.now()+86400000||Date.now()-date>72*3600000)throw new Error('Security scanner definitions need updating.');
  const result=await command(socketPath,'INSTREAM',bytes);
  if(result==='stream: OK')return true;
  if(/^stream: .+ FOUND$/.test(result))return false;
  throw new Error('Security scan did not complete.');
}
