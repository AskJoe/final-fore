'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { DraftSync,type DraftSyncStatus } from '@/lib/orders/draft-sync';
import type { OrderDetail,OrderDocument } from '@/lib/orders/store';

export function useDraftSync(document:OrderDocument,initial:OrderDocument,
  save:(document:OrderDocument)=>Promise<OrderDetail|undefined>,enabled:boolean) {
  const current=useRef(document),callback=useRef(save),initialValue=useRef(initial);
  current.current=document;callback.current=save;initialValue.current=initial;
  const sync=useRef<DraftSync<OrderDocument,OrderDetail>|null>(null);
  const [status,setStatus]=useState<DraftSyncStatus>({phase:'saved'});
  const [acknowledged,setAcknowledged]=useState(initial);
  useEffect(()=>{
    if(!enabled)return;
    const writer=new DraftSync({initial:initialValue.current,save:async(value:OrderDocument)=>{
      const result=await callback.current(value);
      if(!result)throw new Error('Could not save your draft. Your edits are still here. Retry before leaving.');
      return result;
    },changed:setStatus,accepted:(value)=>setAcknowledged(value)});
    sync.current=writer;
    setAcknowledged(initialValue.current);
    writer.set(current.current);
    return ()=>{writer.dispose();sync.current=null;};
  },[enabled,initial]);
  useEffect(()=>{sync.current?.set(document);},[document]);
  const flush=useCallback(async(ensure=false)=>{
    if(!enabled)return undefined;
    const writer=sync.current;
    if(!writer)throw new Error('The editor is still opening. Try again.');
    writer.set(current.current);
    return writer.flush(ensure);
  },[enabled]);
  const dirty=JSON.stringify(document)!==JSON.stringify(acknowledged);
  return {status,dirty,flush};
}
