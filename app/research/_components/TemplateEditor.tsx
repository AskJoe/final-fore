'use client';
import { useState } from 'react';
import type { ResearchWorkspace } from '@/lib/research/workspace';
import type { TemplateDraft } from '@/lib/research/types';

const labels:Record<string,string>={client:'Client',campaign_year:'Year',sender_name:'Sender',sender_title:'Title',sender_email:'Sender email',flight_dates:'Flight dates',radio_trender_books:'Radio trender books',ranker_books:'Ranker books',tv_books:'TV books',avail_book:'Availability book'};
export default function TemplateEditor({workspace}:{workspace:ResearchWorkspace}){
  const [templates,setTemplates]=useState(workspace.templates),[id,setId]=useState(templates[0].id),[changed,setChanged]=useState<string[]>([]),[search,setSearch]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const template=templates.find(t=>t.id===id)!;
  const dirty=changed.includes(id);
  function edit(change:Partial<TemplateDraft>){setTemplates(rows=>rows.map(t=>t.id===id?{...t,...change}:t));setChanged(ids=>ids.includes(id)?ids:[...ids,id]);setMessage('');}
  function toggle(label:string){
    const selected=template.markets.some(m=>m.displayName===label),choice=workspace.markets.find(m=>m.label===label)!;
    const next=selected?template.markets.filter(m=>m.displayName!==label):template.scope==='single'?[{marketId:choice.marketId,displayName:label}]:[...template.markets,{marketId:choice.marketId,displayName:label}];
    // Preserve the source ordering, independent of the order checkboxes are clicked.
    next.sort((a,b)=>workspace.markets.findIndex(m=>m.label===a.displayName)-workspace.markets.findIndex(m=>m.label===b.displayName));edit({markets:next,...(template.scope==='single'&&next.length===1?{name:`${template.media==='broadcast-radio'?'Radio':'TV'} · Single-market · ${next[0].displayName}`}:{})});
  }
  async function save(publish=false){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/research/templates/'+(publish?'publish':'save'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(publish?{templateId:id,revision:template.revision}:{template,revision:template.revision})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setTemplates(rows=>rows.map(t=>t.id===id?result.template??result.version:t));setChanged(ids=>ids.filter(x=>x!==id));setMessage(publish?'Published.':'Saved.');
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}
  }
  async function copy(){
    setBusy(true);setMessage('');
    try{const response=await fetch('/api/research/templates/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateId:id,revision:template.revision})}),result=await response.json();if(!response.ok)throw new Error(result.error);setTemplates(rows=>[...rows,result.template]);setId(result.template.id);setMessage('Copy saved. Choose its markets here.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to copy template.');}finally{setBusy(false);}
  }
  return <><div className="research-title"><h1>Templates</h1>{!workspace.canSave&&<span className="research-note">Database setup pending · edits are not saved yet</span>}</div>
    <div className="research-template-tabs" role="tablist" aria-label="Email templates">{templates.map(t=><button key={t.id} role="tab" aria-selected={t.id===id} onClick={()=>{setId(t.id);setSearch('');setMessage('');}}>{t.name}<span>{t.markets.length} {t.markets.length===1?'market':'markets'}</span></button>)}</div>
    <div className="research-template-grid"><section className="research-market-editor" aria-label="Template markets"><div className="research-section-heading"><h2>Markets</h2><span>{template.markets.length} selected</span></div><input aria-label="Find template market" placeholder="Find market" value={search} onChange={e=>setSearch(e.target.value)}/><div className="research-market-options">{workspace.markets.filter(m=>m.label.toLowerCase().includes(search.toLowerCase())).map(m=><label key={m.label} className="research-market-option"><input type="checkbox" checked={template.markets.some(x=>x.displayName===m.label)} onChange={()=>toggle(m.label)}/><span>{m.label}</span>{!m.marketId&&<span className="research-pending" title="Platform record confirmation is a launch check">Link pending</span>}</label>)}</div></section>
      <section className="research-template-content" aria-label="Template content"><label>Name<input value={template.name} onChange={e=>edit({name:e.target.value})}/></label><label>Subject<input value={template.subject} onChange={e=>edit({subject:e.target.value})}/></label><label>Full email<textarea aria-label="Full email" className="research-body-editor" value={template.body} onChange={e=>edit({body:e.target.value})}/></label><details className="research-details"><summary>Campaign &amp; sender fields</summary><div className="research-fields">{Object.entries(template.defaults).filter(([k])=>['client','campaign_year','sender_name','sender_title','sender_email'].includes(k)||template.body.includes('{{'+k+'}}')).map(([key,value])=><label key={key}>{labels[key]??key}<input value={value} onChange={e=>edit({defaults:{...template.defaults,[key]:e.target.value}})}/></label>)}</div></details>
      <div className="research-actions"><span role="status">{message|| (dirty?'Unsaved changes':'')}</span><button disabled={!workspace.canSave||busy||dirty} onClick={()=>void copy()}>Copy template</button><button disabled={!workspace.canSave||busy||(!dirty&&template.revision>0)} onClick={()=>save()}>Save template</button><button className="research-primary" disabled={!workspace.canSave||busy||dirty||template.markets.some(m=>!m.marketId)} onClick={()=>save(true)}>Publish</button></div></section></div></>;
}
