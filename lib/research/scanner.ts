import { createHash } from 'node:crypto';

export async function scanResearchFile(bytes:Buffer):Promise<boolean>{
  const url=process.env.FINAL_FORE_RESEARCH_SCANNER_URL,key=process.env.FINAL_FORE_RESEARCH_SCANNER_KEY;
  if(!url||!key)throw new Error('Research file scanner is not configured.');
  const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.protocol==='http:'))throw new Error('File scanner requires HTTPS.');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+key},body:new Uint8Array(bytes),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('File scanner is temporarily unavailable.');
  const result=await response.json();if(typeof result.clean!=='boolean'||result.sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('File scanner result could not be verified.');return result.clean;
}

/** Portal uploads use the same scanner as email attachments whenever one is configured. */
export function portalScanner():((bytes:Buffer)=>Promise<boolean>)|undefined {
  return process.env.FINAL_FORE_RESEARCH_SCANNER_URL&&process.env.FINAL_FORE_RESEARCH_SCANNER_KEY?scanResearchFile:undefined;
}
