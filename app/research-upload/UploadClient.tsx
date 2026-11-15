'use client';
import { useEffect, useRef, useState } from 'react';
import {uploadStatus} from '@/lib/research/file-status';
import { Upload } from 'tus-js-client';
import { UploadLayout, UploadMarket } from './UploadLayout';
export type FileRow={id:string;marketId:string|null;name:string;size:number;state:string;error:string|null;updatedAt:string;checkDeadline?:string|null};
type Job={id:string;marketId:string;file:File;status:string;progress:number;hash?:string;serverId?:string;error?:string};
type Props={token:string;firmName:string;media:string;deadline:string;markets:{marketId:string|null;displayName:string}[];initialFiles:FileRow[];initialState:string;storageUrl:string;preview:boolean;ensureToken?:()=>Promise<string>;testMode?:boolean};
export default function UploadClient(props:Props){
  const [files,setFiles]=useState(props.initialFiles),[portalState,setPortalState]=useState(props.initialState),[search,setSearch]=useState(''),[notice,setNotice]=useState(''),[,refresh]=useState(0);
  const portalToken=useRef(props.token);
  const loading=useRef(false);
  const jobs=useRef<Job[]>([]),active=useRef(new Set<string>()),transfers=useRef(new Map<string,Upload>()),mounted=useRef(true),workers=useRef(new Set<Worker>());
  const redraw=()=>{if(mounted.current)refresh(v=>v+1);};
  async function api(action:string,data:Record<string,unknown>={}){const r=await fetch('/api/research-upload/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:portalToken.current,...data}),signal:AbortSignal.timeout(30000)});const result=await r.json();if(!r.ok)throw new Error(result.error??'Unable to upload. Retry.');return result;}
  async function load(){if(!portalToken.current||loading.current)return;loading.current=true;try{const result=await api('list');if(mounted.current){setFiles(result.files);for(const job of jobs.current){if(job.serverId&&result.files.some((f:FileRow)=>f.id===job.serverId&&['ready','held'].includes(f.state)))job.status='complete';}setPortalState(result.portalState);setNotice('');}}catch(e){if(mounted.current)setNotice(e instanceof Error?e.message:'Unable to refresh files.');}finally{loading.current=false;}}
  useEffect(()=>{mounted.current=true;const timer=setInterval(()=>{redraw();if(document.visibilityState==='visible')void load();},5000);const warn=(e:BeforeUnloadEvent)=>{if(active.current.size){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('beforeunload',warn);for(const upload of transfers.current.values())void upload.abort();for(const w of workers.current)w.terminate();};},[]); // This page is bound to one token for its lifetime.
  function fingerprint(file:File){return new Promise<string>((resolve,reject)=>{const worker=new Worker(new URL('./hash-worker.ts',import.meta.url));workers.current.add(worker);const timer=setTimeout(()=>{finish();reject(new Error('Could not read this file in time. Please choose it again.'));},60000);const finish=()=>{clearTimeout(timer);workers.current.delete(worker);worker.terminate();};worker.onmessage=e=>{finish();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.hash);};worker.onerror=()=>{finish();reject(new Error('Unable to read the file. Choose it again.'));};worker.postMessage(file);});}
  function pump(){if(!mounted.current)return;for(const job of jobs.current){if(active.current.size>=2)break;if(job.status==='queued'&&!active.current.has(job.id)){active.current.add(job.id);void run(job);}}}
  async function run(job:Job){
    try{
      if(!portalToken.current&&props.ensureToken)portalToken.current=await props.ensureToken();
      if(job.file.size===0||job.file.size>100*1024*1024)throw new Error('Files must be between 1 byte and 100 MiB.');job.status='Preparing upload';redraw();job.hash??=await fingerprint(job.file);if(!mounted.current)return;
      const reserved=await api('reserve',{file:{marketId:job.marketId,name:job.file.name,size:job.file.size,sha256:job.hash}});job.serverId=reserved.file.id;
      if(reserved.grant){
        job.status='Uploading';redraw();
        await new Promise<void>((resolve,reject)=>{
          let lastProgress=Date.now(),started=lastProgress,settled=false;
          const finish=(error?:Error)=>{if(settled)return;settled=true;clearInterval(watchdog);error?reject(error):resolve();};
          const watchdog=setInterval(()=>{if(Date.now()-lastProgress>45000||Date.now()-started>600000){void upload.abort();finish(new Error('Upload timed out. Please retry this file.'));}},5000);
          // Signed object grants use Storage's signature-verifying route, not its session-JWT route.
          const upload=new Upload(job.file,{endpoint:props.storageUrl+'/storage/v1/upload/resumable/sign',headers:{'x-signature':reserved.grant.token},chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000,10000],onBeforeRequest:req=>{const xhr=req.getUnderlyingObject();if(xhr instanceof XMLHttpRequest)xhr.timeout=30000;},uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,metadata:{bucketName:reserved.grant.bucket,objectName:reserved.grant.objectKey,contentType:reserved.grant.contentType,cacheControl:'3600'},fingerprint:async()=>`final-fore/${job.serverId}/${job.hash}`,onProgress:(sent,total)=>{lastProgress=Date.now();job.progress=Math.floor(sent/total*100);redraw();},onError:error=>finish(error),onSuccess:()=>finish()});
          transfers.current.set(job.id,upload);upload.findPreviousUploads().then(previous=>{if(previous[0])upload.resumeFromPreviousUpload(previous[0]);upload.start();}).catch(e=>finish(e));
        });
        if(!mounted.current)return;await api('finalize',{fileId:job.serverId});
      }
      job.status='complete';await load();
    }catch(e){job.status='failed';job.error=e instanceof Error?e.message:'Upload interrupted. Retry this file.';}
    finally{transfers.current.delete(job.id);active.current.delete(job.id);redraw();pump();}
  }
  function choose(marketId:string,list:FileList|null){if(!list)return;for(const file of Array.from(list)){if(file.size===0||file.size>100*1024*1024){jobs.current.push({id:crypto.randomUUID(),marketId,file,status:'failed',progress:0,error:'Files must be between 1 byte and 100 MiB.'});continue;}jobs.current.push({id:crypto.randomUUID(),marketId,file,status:'queued',progress:0});}redraw();pump();}
  const visibleFiles=files.map(f=>({...f,...uploadStatus({state:f.state,error:f.error,check_deadline:f.checkDeadline,updated_at:f.updatedAt})}));
  const states:Record<string,string>={checking:'Finishing upload',held:'Invalid file. Please choose a valid document and upload it again.',failed:'Upload failed. Please upload again.',uploading:'Choose file to resume'};
  return <UploadLayout firmName={props.firmName} media={props.media} deadline={props.deadline} title={props.testMode?'Upload research':props.preview?'Test upload page':'Upload research'} fileCount={files.filter(f=>['ready','checking','held'].includes(f.state)).length} note={props.testMode?<>Test uploads · uploading does not send email · <a href="/research/files" target="_blank" rel="noopener noreferrer">View incoming files</a>{portalToken.current&&<> · <a href={'/research-upload/'+portalToken.current} target="_blank" rel="noreferrer">Rep upload link (no login)</a></>}</>:props.preview?'Preview only · test files stay separate · link expires in 24 hours':undefined} search={search} onSearch={setSearch} closed={portalState!=='open'} notice={notice}>
    {props.markets.filter(m=>m.displayName.toLowerCase().includes(search.toLowerCase())).map(m=>{
      const pending=jobs.current.filter(j=>j.marketId===m.marketId&&j.status!=='complete'),pendingIds=new Set(pending.map(j=>j.serverId));
      return <UploadMarket key={m.displayName} name={m.displayName} disabled={portalState!=='open'||!m.marketId} onChoose={e=>{if(m.marketId)choose(m.marketId,e.target.files);e.target.value='';}}>
        {!m.marketId&&<small>Confirm this market in the template to enable uploads.</small>}
        {visibleFiles.filter(f=>f.marketId===m.marketId&&!pendingIds.has(f.id)).map(f=><span className="rep-file" key={f.id}>{f.state==='ready'?<a href={`/research-upload/${portalToken.current}/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>:<span>{f.name}</span>}{f.state!=='ready'&&<small className={['held','failed'].includes(f.state)?'rep-error':undefined}>{f.error??states[f.state]??f.state}</small>}</span>)}
        {pending.map(j=><span className="rep-file" key={j.id}><span>{j.file.name}</span>{j.status==='failed'?<><small className="rep-error">{j.error}</small><button onClick={()=>{j.status='queued';j.error=undefined;pump();redraw();}}>Retry</button></>:<small>{j.status==='Uploading'?`${j.progress}%`:j.status}</small>}</span>)}
      </UploadMarket>;
    })}</UploadLayout>;
}
