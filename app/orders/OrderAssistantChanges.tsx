'use client';
import { useEffect,useState } from 'react';
import type { OrderDetail,OrderLine } from '@/lib/orders/store';
import type { OrderSection } from '@/lib/order-assistant/types';
import { assistantRequest } from './useOrderResearchState';
import { usd } from './OrdersCatalog';

type Proposal={id:string;contextId:string;hash:string;status:'pending'|'applied';undoOf?:string;section:OrderSection;
  beforeTotal:number;afterTotal:number;before:OrderLine[];after:OrderLine[];note:string};
export function OrderAssistantChanges({orderId,section,beforeApply,onUpdate,onBusy}:{orderId?:string;section:OrderSection;
  beforeApply:()=>Promise<void>;onUpdate:(order:OrderDetail)=>void;onBusy?:(busy:boolean)=>void}){
  const [proposals,setProposals]=useState<Proposal[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(){if(orderId)setProposals(await assistantRequest({action:'proposals',orderId}));}
  useEffect(()=>{
    if(!orderId)return;
    let active=true;
    const read=()=>void assistantRequest<Proposal[]>({action:'proposals',orderId}).then(value=>{if(active)setProposals(value);})
      .catch(problem=>{if(active)setError(problem.message);});
    read();
    const timer=setInterval(()=>{if(window.document.visibilityState==='visible')read();},5000);
    window.addEventListener('focus',read);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',read);};
  },[orderId]);
  async function apply(proposal:Proposal,undo=false){
    setBusy(true);onBusy?.(true);setError('');
    try{
      await beforeApply();
      const reviewed=undo?await assistantRequest<Proposal>({action:'undo',orderId,proposalId:proposal.id,section}):proposal;
      const saved=await assistantRequest<OrderDetail>({action:'apply',contextId:reviewed.contextId,proposalId:reviewed.id,hash:reviewed.hash,section});
      onUpdate(saved);await load();
    }catch(problem){setError(problem instanceof Error?problem.message:'Could not apply this proposal.');}
    finally{setBusy(false);onBusy?.(false);}
  }
  const current=proposals.filter(item=>item.section===section);
  if(!current.length&&!error)return null;
  const pending=current.filter(item=>item.status==='pending');
  const shown=[...pending,...current.filter(item=>item.status==='applied').slice(0,1)];
  return <details className="ow-assistant-changes"><summary>ChatGPT suggestions ({pending.length} pending)</summary>
    {error&&<p role="alert">{error}</p>}
    {shown.map(item=><section key={item.id} aria-label="Proposed order changes">
      <p>{item.status==='applied'?'Applied':'Proposed'}: {usd.format(item.beforeTotal/100)} → {usd.format(item.afterTotal/100)}</p>
      <ul>{item.before.filter(line=>!item.after.some(next=>next.id===line.id)).map(line=><li key={'remove:'+line.id}>Remove {line.station} · {line.program}
        {' · '}{line.start||'Start needed'} – {line.end||'End needed'}{' · '}{line.source?.label}{' · '}{line.source?.locator}</li>)}
        {item.after.filter(line=>!item.before.some(prior=>prior.id===line.id)).map(line=><li key={'add:'+line.id}>Add {line.station} · {line.program}
          {' · '}{line.quantity??'Quantity needed'} spots · {line.rate==null?'Rate needed':usd.format(line.rate/100)}
          {' · '}{line.start||'Start needed'} – {line.end||'End needed'}{' · '}{line.source?.label}{' · '}{line.source?.locator}</li>)}</ul>
      {item.status==='pending'?<>
        <button type="button" disabled={busy} onClick={()=>void apply(item)}>Apply these changes</button>{' '}
        <button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{
          await beforeApply();await assistantRequest({action:'refresh',orderId,proposalId:item.id,section});await load();
        }catch(problem){setError(problem instanceof Error?problem.message:'Could not refresh the proposal.');}finally{setBusy(false);}}}>Refresh proposal</button>
      </>:!item.undoOf&&<button type="button" disabled={busy} onClick={()=>void apply(item,true)}>Undo these changes</button>}
      <p>{item.note}</p>
    </section>)}
  </details>;
}
