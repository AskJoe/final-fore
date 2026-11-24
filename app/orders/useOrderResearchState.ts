'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { OrderDetail } from '@/lib/orders/store';
import type { DraftRecovery,ResearchState,ResearchView } from '@/lib/order-assistant/types';
import { DraftSync,type DraftSyncStatus } from '@/lib/orders/draft-sync';

export async function assistantRequest<Result>(input:Record<string,unknown>):Promise<Result>{
  const response=await fetch('/api/order-assistant',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??'Could not save market research.');
  return result as Result;
}
export function useOrderResearchState(orderId:string|undefined,ensure:()=>Promise<OrderDetail|undefined>){
  const [state,setState]=useState<ResearchState|null>(null),[error,setError]=useState('');
  const [readyOrder,setReadyOrder]=useState<string>();
  const [viewConflict,setViewConflict]=useState(false);
  const personalBase=useRef<number|undefined>(undefined);
  const starTask=useRef<Promise<void>|null>(null);
  const pendingStar=useRef<{sheet:string;rowId:string;starred:boolean;operationId:string;expectedRevision:number}|null>(null);
  const starError=useRef('');
  const [saving,setSaving]=useState(false),[status,setStatus]=useState<DraftSyncStatus>({phase:'saved'});
  const stateRef=useRef<ResearchState|null>(null),ensureRef=useRef(ensure);ensureRef.current=ensure;
  const writer=useRef<DraftSync<{view:ResearchView;recovery:DraftRecovery|null},ResearchState>|null>(null);
  const view=useRef<ResearchView>({sheet:'tv'}),recovery=useRef<DraftRecovery|null>(null);
  const loaded=useRef<string|undefined>(undefined),alive=useRef(true);
  const loading=useRef<{id:string;promise:Promise<void>}|null>(null);
  const starLock=useRef(false);
  const accept=useCallback((next:ResearchState)=>{
    const previous=stateRef.current;
    const merged=previous?.orderId===next.orderId?{...next,
      ...(previous.revision>next.revision?{revision:previous.revision,shortlist:previous.shortlist}:{}),
      ...(previous.viewRevision>next.viewRevision?{viewRevision:previous.viewRevision,view:previous.view,recovery:previous.recovery}:{})}:next;
    stateRef.current=merged;if(alive.current)setState(merged);return merged;
  },[]);
  const load=useCallback(async(id:string)=>{
    const result=await assistantRequest<ResearchState>({action:'state',orderId:id});
    const merged=accept(result);
    if(loaded.current===id&&personalBase.current!==undefined&&merged.viewRevision>personalBase.current&&alive.current)setViewConflict(true);
    if(alive.current&&!starError.current)setError('');return merged;
  },[accept]);
  const initialize=useCallback((id:string):Promise<void>=>{
    if(loaded.current===id&&writer.current)return Promise.resolve();
    if(loading.current?.id===id)return loading.current.promise;
    const promise=(async()=>{
      const result=await load(id);
      if(!alive.current)return;
      loaded.current=id;view.current=result.view??view.current;recovery.current=result.recovery;personalBase.current=result.viewRevision;
      const operations=new Map<string,Record<string,unknown>>();
      const queue=new DraftSync({initial:{view:view.current,recovery:result.recovery},
        save:async(value:{view:ResearchView;recovery:DraftRecovery|null})=>{
          const current=stateRef.current;if(!current)throw new Error('Research is still opening.');
          const key=JSON.stringify(value);
          const input=operations.get(key)??{action:'view',orderId:id,expectedRevision:personalBase.current,operationId:crypto.randomUUID(),...value};
          operations.set(key,input);
          const result=await assistantRequest<ResearchState>(input);
          personalBase.current=result.viewRevision;operations.delete(key);const merged=accept(result);setViewConflict(merged.viewRevision>result.viewRevision);return merged;
        },changed:next=>{if(alive.current)setStatus(next);}});
      writer.current?.dispose();writer.current=queue;setReadyOrder(id);setViewConflict(false);
    })().finally(()=>{loading.current=null;});
    loading.current={id,promise};return promise;
  },[load,accept]);
  useEffect(()=>{
    alive.current=true;
    if(orderId)void initialize(orderId).catch(problem=>{if(alive.current)setError(problem.message);});
    return ()=>{alive.current=false;loaded.current=undefined;writer.current?.dispose();writer.current=null;};
  },[orderId,initialize]);
  const changeView=useCallback((next:ResearchView)=>{
    view.current=next;if(loaded.current)writer.current?.set({view:next,recovery:recovery.current});
  },[]);
  const changeRecovery=useCallback((next:DraftRecovery|null)=>{
    recovery.current=next;if(loaded.current)writer.current?.set({view:view.current,recovery:next});
  },[]);
  const flush=useCallback(async(id?:string,override?:DraftRecovery|null)=>{
    const target=id??loaded.current??orderId;
    if(target)await initialize(target);
    if(starTask.current)await starTask.current;
    if(pendingStar.current)throw new Error(starError.current||'The shortlist has not been saved. Retry it before leaving.');
    if(viewConflict)throw new Error('Saved work changed in another window. Review it before continuing.');
    if(override!==undefined){recovery.current=override;writer.current?.set({view:view.current,recovery:override});}
    if(!writer.current&&target)throw new Error('Research is still opening. Retry before leaving.');
    await writer.current?.flush();
  },[initialize,orderId,viewConflict]);
  const star=useCallback((sheet:string,rowId:string,starred:boolean):Promise<void>=>{
    if(starTask.current)return starTask.current;
    const prior=pendingStar.current;
    if(prior&&(prior.sheet!==sheet||prior.rowId!==rowId||prior.starred!==starred)){
      setError('Retry the pending shortlist choice before changing another row.');return Promise.resolve();
    }
    starLock.current=true;setSaving(true);setError('');
    const task=(async()=>{
      const order=await ensureRef.current(),id=order?.id??orderId;
      if(!id)throw new Error('Save this draft before shortlisting research.');
      await initialize(id);
      const operation=prior??{sheet,rowId,starred,expectedRevision:stateRef.current!.revision,operationId:crypto.randomUUID()};
      pendingStar.current=operation;
      const result=await assistantRequest<ResearchState>({action:'stars',orderId:id,sheet:operation.sheet,expectedRevision:operation.expectedRevision,
        items:[{rowId:operation.rowId,starred:operation.starred}],operationId:operation.operationId});
      accept(result);pendingStar.current=null;starError.current='';
    })().catch(problem=>{
      starError.current=problem instanceof Error?problem.message:'Could not save shortlist.';
      if(alive.current)setError(starError.current);
      throw problem;
    }).finally(()=>{starLock.current=false;starTask.current=null;if(alive.current)setSaving(false);});
    starTask.current=task;
    // The event handler is fire-and-forget; flush and explicit retry still observe the rejected promise.
    void task.catch(()=>{});return task;
  },[orderId,initialize,accept]);
  const useSavedWork=useCallback(async()=>{
    if(!orderId)return;
    writer.current?.dispose();writer.current=null;loaded.current=undefined;personalBase.current=undefined;
    setReadyOrder(undefined);await initialize(orderId);return stateRef.current;
  },[orderId,initialize]);

  return {state,error,saving,status,star,changeView,changeRecovery,flush,viewConflict,useSavedWork,ready:!orderId||readyOrder===orderId,
    retryStar:()=>pendingStar.current?star(pendingStar.current.sheet,pendingStar.current.rowId,pendingStar.current.starred):Promise.resolve(),
    reload:()=>orderId?load(orderId):Promise.resolve(null)};
}
