'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { ResearchWorkspace } from '@/lib/research/workspace';
export default function Coverage({rep,workspace,onSaved}:{rep:ResearchWorkspace['reps'][number];workspace:ResearchWorkspace;onSaved:(w:ResearchWorkspace)=>void}){
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  async function confirm(templateId:string,confirmed:boolean,revision:number){setBusy(templateId);setError('');try{const response=await fetch('/api/research/assignments/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repId:rep.id,templateId,confirmed,revision})}),data=await response.json();if(!response.ok)throw new Error(data.error);const refreshed=await fetch('/api/research/workspace'),w=await refreshed.json();if(!refreshed.ok)throw new Error(w.error);onSaved(w);}catch(e){setError(e instanceof Error?e.message:'Unable to confirm coverage.');}finally{setBusy('');}}
  const choices = rep.choices.filter(choice => choice.canEditCoverage);
  if(!choices.length)return null;
  return <details className="research-coverage"><summary>{choices.some(c=>c.confirmed)?'Edit coverage':'Confirm coverage'}</summary>{choices.map(c=>{const template=workspace.templates.find(t=>t.id===c.templateId)!;return <div key={c.templateId}><span>{template.name}</span>{workspace.canSave&&template.revision===0?<Link href="/research/templates">Save template first</Link>:<button disabled={!workspace.canSave||!!busy} onClick={()=>void confirm(c.templateId,!c.confirmed,c.revision)}>{c.confirmed?'Remove':'Confirm'}</button>}</div>;})}{error&&<p role="alert" className="research-error">{error}</p>}</details>;
}
