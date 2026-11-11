'use client';
import { useEffect, useRef, useState } from 'react';
import type { ResearchWorkspace } from '@/lib/research/workspace';
import type { Recipient, Selection } from '@/lib/research/types';
import type { TemplateInspection } from '@/lib/research/template-inspection';

type Props={selection:Selection;workspace:ResearchWorkspace;deadline:string;onClose:()=>void};
export default function TemplatePreviewDrawer({selection,workspace,deadline,onClose}:Props){
  const template=workspace.templates.find(t=>t.id===selection.templateId)!,rep=workspace.reps.find(r=>r.id===selection.repId)!;
  const [preview,setPreview]=useState<{email:TemplateInspection;recipient:Recipient}|null>(null),[format,setFormat]=useState<'html'|'text'>('html'),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{const controller=new AbortController();let active=true;
    void fetch('/api/research/template-preview?'+new URLSearchParams({...selection,deadline}),{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);if(active){setPreview(data);setError('');}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to preview this template.');});
    return()=>{active=false;controller.abort();};
  },[selection.repId,selection.templateId,deadline,retry]);
  return <dialog ref={dialog} className="research-template-drawer" aria-labelledby="template-drawer-title" onCancel={onClose} onClose={onClose}>
    <header className="research-drawer-header"><div><h2 id="template-drawer-title">{template.name}</h2><span>{rep.name}</span></div><button onClick={onClose} aria-label="Close template preview">Close</button></header>
    <div className="research-drawer-content">
      {error?<p role="alert" className="research-error">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!preview&&<p role="status" className="research-note">Loading email…</p>}
      {preview&&<><div className="research-email-address"><div><span>To</span>{preview.recipient.to}</div>{!!preview.recipient.cc.length&&<div><span>CC</span>{preview.recipient.cc.join(', ')}</div>}<div><span>Subject</span><strong>{preview.email.subject}</strong></div></div>
        <div className="research-format-tabs" role="tablist" aria-label="Email format"><button role="tab" aria-selected={format==='html'} aria-controls="template-preview-content" onClick={()=>setFormat('html')}>HTML</button><button role="tab" aria-selected={format==='text'} aria-controls="template-preview-content" onClick={()=>setFormat('text')}>Plain text</button></div>
        {!!preview.email.missing.length&&<p className="research-pending">Missing: {preview.email.missing.join(', ')}.</p>}
        <div id="template-preview-content" role="tabpanel" aria-label={format==='html'?'HTML email':'Plain text email'}>{format==='html'?<div className="research-email-html" dangerouslySetInnerHTML={{__html:preview.email.html}}/>:<article className="research-email-body">{preview.email.text}</article>}</div>
      </>}
    </div>
  </dialog>;
}
