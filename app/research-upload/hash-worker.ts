import { sha256 } from '@noble/hashes/sha2.js';
const worker=self as unknown as {onmessage:((event:MessageEvent<File>)=>void)|null;postMessage:(value:unknown)=>void};
worker.onmessage=async(event)=>{
  try{const hash=sha256.create(),file=event.data;for(let offset=0;offset<file.size;offset+=1024*1024)hash.update(new Uint8Array(await file.slice(offset,offset+1024*1024).arrayBuffer()));worker.postMessage({hash:hash.digest().reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'')});}
  catch{worker.postMessage({error:'Unable to read the file. Choose it again.'});}
};
