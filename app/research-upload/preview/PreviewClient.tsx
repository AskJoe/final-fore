'use client';
import {useRef,useState} from 'react';
import {UploadLayout,UploadMarket} from '../UploadLayout';
import UploadClient,{type FileRow} from '../UploadClient';
import type {MarketRef,PreviewInput} from '@/lib/research/types';
type Session={token:string;initialFiles:FileRow[];initialState:string};
export default function PreviewClient({firmName,media,deadline,markets,input,enabled,existing,storageUrl}:{firmName:string;media:string;deadline:string;markets:MarketRef[];input:PreviewInput;enabled:boolean;existing:Session|null;storageUrl:string}){
  const [search,setSearch]=useState('');const starting=useRef<Promise<string>|null>(null);
  async function ensureToken(){
    if(!starting.current)starting.current=(async()=>{try{const r=await fetch('/api/research/upload-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)}),d=await r.json();if(!r.ok)throw new Error(d.error??'Unable to start test upload. Retry.');return d.token as string;}catch(e){starting.current=null;throw e;}})();
    return starting.current;
  }
  if(enabled)return <UploadClient token={existing?.token??''} initialFiles={existing?.initialFiles??[]} initialState={existing?.initialState??'open'} firmName={firmName} media={media} deadline={deadline} markets={markets} storageUrl={storageUrl} preview testMode ensureToken={ensureToken}/>;
  return <UploadLayout firmName={firmName} media={media} deadline={deadline} title="Upload research" fileCount={0} note="Page preview · file uploads are disabled" search={search} onSearch={setSearch}>
    {markets.filter(m=>m.displayName.toLowerCase().includes(search.toLowerCase())).map(m=><UploadMarket key={m.displayName} name={m.displayName} disabled/>)}</UploadLayout>;
}
