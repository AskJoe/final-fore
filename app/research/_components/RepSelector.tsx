'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { ResearchWorkspace } from '@/lib/research/workspace';
import type { Recipient, RenderedEmail, Selection } from '@/lib/research/types';
import Coverage from './Coverage';
import BulkFields from './BulkFields';
import TemplatePreviewDrawer from './TemplatePreviewDrawer';

type Preview={email:RenderedEmail;previewHtml:string;recipient:Recipient;templateName:string;previewId?:string;setupPreview:boolean};
type SendReference={previewId:string;renderHash:string};
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export default function RepSelector({workspace:initialWorkspace}:{workspace:ResearchWorkspace}){
  const [workspace,setWorkspace]=useState(initialWorkspace);
  const [search,setSearch]=useState(''),[selections,setSelections]=useState<Selection[]>([]),[deadline,setDeadline]=useState(''),[previews,setPreviews]=useState<Preview[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selectedPreview,setSelectedPreview]=useState(0),[notice,setNotice]=useState(''),[previewTo,setPreviewTo]=useState(workspace.previewRecipients[0]??''),[portalUrl,setPortalUrl]=useState('');
  const [previewFormat,setPreviewFormat]=useState<'html'|'text'>('html');
  const [editingFields,setEditingFields]=useState(false);
  const [testRecipients,setTestRecipients]=useState('');
  const [drawer,setDrawer]=useState<Selection|null>(null);
  const pendingSend=useRef<{idempotencyKey:string;previews:SendReference[]}|null>(null);
  const testKey=useRef('');
  const preview=previews[selectedPreview],key=(s:Selection)=>s.repId+'/'+s.templateId;
  const ready=workspace.canSend&&selections.length>0&&!!deadline;
  function closePreview(){setPreviewFormat('html');setPreviews([]);setSelectedPreview(0);testKey.current='';setNotice('');setPortalUrl('');}
  function invalidate(){pendingSend.current=null;closePreview();}
  function toggle(s:Selection){setSelections(rows=>rows.some(x=>key(x)===key(s))?rows.filter(x=>key(x)!==key(s)):[...rows,s]);invalidate();}
  async function post(action:string,body:unknown){const response=await fetch('/api/research/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new RequestError(data.error,response.status);return data;}
  async function openPreview(){
    setBusy(true);setError('');closePreview();
    try{const data=await post('preview-batch',{selections,deadline});setPreviews(data.previews);}catch(e){setError(e instanceof Error?e.message:'Unable to preview.');}finally{setBusy(false);}
  }
  async function send(){
    if (!ready || busy) return;
    setBusy(true);setError('');
    try{
      if (!pendingSend.current) {
        const allPrepared = previews.length > 0 && previews.every(p=>p.previewId && !p.email.missing.length);
        const references = allPrepared
          ? previews.map(p=>({previewId:p.previewId!,renderHash:p.email.renderHash}))
          : (await post('prepare-send',{selections,deadline})).previews;
        pendingSend.current = {idempotencyKey:crypto.randomUUID(),previews:references};
      }
      const data=await post('send',pendingSend.current);
      invalidate();
      setSelections([]);
      setNotice(data.conversationIds.length+' emails queued. Track delivery in Inbox.');
    }catch(e){
      if (e instanceof RequestError && (e.status===400 || e.status===409)) {
        pendingSend.current=null;
        if(previews.some(p=>p.previewId)) closePreview();
      }
      setError(e instanceof Error?e.message:'Unable to queue email.');
    }finally{setBusy(false);}
  }
  async function sendPreview(){
    if (!preview) return;
    setBusy(true);setError('');
    try{
      testKey.current ||=crypto.randomUUID();
      const data=await post('send-preview',{previewId:preview.previewId,renderHash:preview.email.renderHash,idempotencyKey:testKey.current,recipient:previewTo});
      setNotice('Preview queued for '+previewTo+'.');setPortalUrl(data.portalUrl);
    }catch(e){setError(e instanceof Error?e.message:'Unable to queue preview.');}finally{setBusy(false);}
  }
  async function sendTest(){
    if(!preview)return;
    setBusy(true);setError('');
    try{testKey.current ||=crypto.randomUUID();const data=await post('send-test',{templateId:preview.recipient.templateId,repId:preview.recipient.repId,deadline,renderHash:preview.email.renderHash,testRecipients,idempotencyKey:testKey.current});setNotice('Test email queued only for '+data.recipients.join(', ')+'.');setPortalUrl(data.portalUrl);}
    catch(e){setError(e instanceof Error?e.message:'Unable to queue test email.');}finally{setBusy(false);}
  }
  return <><div className="research-title"><h1>{preview?'Email preview':'Reps & email'}</h1>{workspace.testOnly?<span className="research-note">Test mode · vendor sending blocked</span>:!workspace.canSend&&<span className="research-note">Sending is off</span>}</div>
    {error&&<p className="research-error" role="alert">{error}</p>}{notice&&<p role="status" className="research-note">{notice} <Link href="/research">Inbox</Link></p>}
    {!preview?<section aria-label="Select reps"><div className="research-select-toolbar"><input aria-label="Find rep or firm" placeholder="Find rep or firm" value={search} onChange={e=>setSearch(e.target.value)}/><span>{selections.length} selected</span><button disabled={!selections.length||busy} onClick={()=>setEditingFields(true)}>Edit fields</button><label>Due date<input type="date" value={deadline} disabled={busy} onChange={e=>{setDeadline(e.target.value);invalidate();}}/></label><div className="research-select-actions"><button disabled={!selections.length||!deadline||busy} onClick={()=>void openPreview()}>Preview</button>{!workspace.testOnly&&<button className="research-primary" disabled={!ready||busy} onClick={()=>void send()}>Send emails</button>}</div></div>
    <table className="research-reps"><thead><tr><th className="research-send-column">Send</th><th>Firm / rep</th><th>Assigned template</th></tr></thead><tbody>{workspace.reps.filter(r=>(r.name+' '+r.firmName+' '+r.email).toLowerCase().includes(search.toLowerCase())).map(rep=><tr key={rep.id}><td>{rep.choices.filter(c=>c.confirmed).map(choice=>{const t=workspace.templates.find(t=>t.id===choice.templateId)!,s={repId:rep.id,templateId:t.id};return <div className="research-send-choice" key={t.id}><input type="checkbox" aria-label={'Send '+t.name+' to '+rep.name} checked={selections.some(x=>key(x)===key(s))} disabled={busy} onChange={()=>toggle(s)}/></div>;})}</td><td><strong>{rep.firmName}</strong><span>{rep.name}</span><a href={'mailto:'+rep.email}>{rep.email}</a></td><td>{rep.choices.some(c=>c.confirmed)?rep.choices.filter(c=>c.confirmed).map(choice=>{const t=workspace.templates.find(t=>t.id===choice.templateId)!;return <div className="research-template-choice" key={t.id}><button className="research-template-link" onClick={()=>setDrawer({repId:rep.id,templateId:t.id})}>{t.name}</button></div>;}):<span className="research-muted">{rep.choices.length?'':'No research assignment'}</span>}<Coverage rep={rep} workspace={workspace} onSaved={w=>{setWorkspace(w);setSelections(rows=>rows.filter(s=>w.reps.find(r=>r.id===s.repId)?.choices.some(c=>c.templateId===s.templateId&&c.confirmed)));invalidate();}}/></td></tr>)}</tbody></table></section>:
    <section className="research-preview" aria-label="Email preview"><div className="research-preview-toolbar"><button onClick={closePreview} disabled={busy}>Back to reps</button><label>Recipient<select aria-label="Preview recipient" value={selectedPreview} disabled={busy} onChange={e=>{setSelectedPreview(Number(e.target.value));testKey.current='';setPortalUrl('');}}>{previews.map((p,i)=><option key={i} value={i}>{p.recipient.name} — {p.templateName}</option>)}</select></label><Link href="/research/templates">Edit templates</Link>{!workspace.testOnly&&<button className="research-primary" disabled={!ready||busy} onClick={()=>void send()}>Send emails</button>}</div>
    {portalUrl&&<a href={portalUrl} target="_blank" rel="noreferrer">Open test upload page</a>}<div className="research-email-address"><div><span>{workspace.testOnly?'Template for':'To'}</span>{preview.recipient.to}</div>{!workspace.testOnly&&!!preview.recipient.cc.length&&<div><span>CC</span>{preview.recipient.cc.join(', ')}</div>}<div><span>Subject</span><strong>{workspace.testOnly?'[TEST] ':''}{preview.email.subject}</strong></div></div>{!!preview.email.missing.length&&<p className="research-pending">Complete template fields: {preview.email.missing.join(', ')}</p>}<div className="research-format-tabs" role="tablist" aria-label="Email format"><button role="tab" aria-selected={previewFormat==='html'} onClick={()=>setPreviewFormat('html')}>HTML</button><button role="tab" aria-selected={previewFormat==='text'} onClick={()=>setPreviewFormat('text')}>Plain text</button></div>{previewFormat==='html'?<article className="research-email-body research-email-html" dangerouslySetInnerHTML={{__html:preview.previewHtml}}/>:<article className="research-email-body">{preview.email.text}</article>}
    <div className="research-actions">{workspace.testOnly?<><label>Test email addresses<input aria-label="Test email addresses" placeholder="Enter addresses, separated by commas" value={testRecipients} disabled={busy} onChange={e=>{setTestRecipients(e.target.value);testKey.current='';setNotice('');}}/></label><button className="research-primary" disabled={!workspace.canTestSend||!testRecipients.trim()||!!preview.email.missing.length||busy} onClick={()=>void sendTest()}>Send test email</button></>:<><select aria-label="Send preview to" value={previewTo} disabled={busy} onChange={e=>{setPreviewTo(e.target.value);testKey.current='';}}>{workspace.previewRecipients.map(email=><option key={email}>{email}</option>)}</select><button disabled={!workspace.canSend||!preview.previewId||!!preview.email.missing.length||busy} onClick={()=>void sendPreview()}>Send preview</button></>}</div>{workspace.testOnly&&<p className="research-note">From: {workspace.testIdentity.from} · Reply-To: {workspace.testIdentity.replyTo}. {workspace.testIdentity.allowedRecipient?<>Until DNS verification, send only to {workspace.testIdentity.allowedRecipient}. </>:null}No vendor recipients or CCs. Upload link lasts 24 hours.</p>}</section>}{editingFields&&<BulkFields workspace={workspace} selections={selections} deadline={deadline} onClose={()=>setEditingFields(false)} onSaved={(templates,due)=>{setWorkspace(w=>({...w,templates:w.templates.map(t=>templates.find(saved=>saved.id===t.id)??t)}));if(due!==undefined)setDeadline(due);invalidate();setNotice(templates.length?`${templates.length} shared templates updated.`:"Due date updated.");}}/>}{drawer&&<TemplatePreviewDrawer selection={drawer} workspace={workspace} deadline={deadline} onClose={()=>setDrawer(null)}/>}</>;
}
