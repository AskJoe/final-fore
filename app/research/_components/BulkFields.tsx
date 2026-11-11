'use client';
import { useEffect, useRef, useState } from 'react';
import { fieldLabels, usesField } from '@/lib/research/template-fields';
import type { ResearchWorkspace } from '@/lib/research/workspace';
import type { Selection, TemplateDraft } from '@/lib/research/types';

type Props={workspace:ResearchWorkspace;selections:Selection[];deadline:string;onClose:()=>void;onSaved:(templates:TemplateDraft[],deadline:string|undefined)=>void};
export default function BulkFields({workspace,selections,deadline,onClose,onSaved}:Props){
  const templates=workspace.templates.filter(t=>selections.some(s=>s.templateId===t.id));
  const keys=Object.keys(fieldLabels).filter(k=>k!=='deadline'&&templates.some(t=>usesField(t,k)));
  const [changes,setChanges]=useState<Record<string,string>>({}),[due,setDue]=useState(deadline),[busy,setBusy]=useState(false),[error,setError]=useState(''),[finished,setFinished]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  const dueChanged=due!==deadline,changed=Object.keys(changes).length>0;
  function current(key:string){const values=[...new Set(templates.filter(t=>usesField(t,key)).map(t=>t.defaults[key]))];return values.length===1?values[0]:'';}
  async function save(){
    setBusy(true);setError('');
    try{
      let saved:TemplateDraft[]=[],failed:{name:string;error:string}[]=[];
      if(changed){const response=await fetch('/api/research/templates/bulk-fields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templates:templates.map(t=>({id:t.id,revision:t.revision})),fields:changes})});const data=await response.json();if(!response.ok)throw new Error(data.error);saved=data.saved;failed=data.failed;}
      onSaved(saved,dueChanged?due:undefined);
      if(failed.length){setFinished(true);setError(`${saved.length} templates saved. ${failed.map(f=>f.name+': '+f.error).join(' ')} Close and reload before trying again.`);}else onClose();
    }catch(e){setFinished(true);setError((e instanceof Error?e.message:'Unable to save.')+' Close and reload to check the latest values before retrying.');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="research-template-drawer research-bulk-drawer" aria-labelledby="bulk-fields-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}} onClose={onClose}>
    <header className="research-drawer-header"><h2 id="bulk-fields-title">Edit fields</h2><button disabled={busy} onClick={onClose}>Close</button></header>
    <form className="research-drawer-content" onSubmit={e=>{e.preventDefault();void save();}}>
      <p className="research-note">{selections.length} selected · {templates.length} shared {templates.length===1?'template':'templates'}</p>
      <p className="research-bulk-names">{templates.map(t=>t.name).join(', ')}</p>
      <p className="research-note">Template fields change for every rep using these templates. Only edited fields are saved.</p>
      <label>Due date<input type="date" value={due} disabled={busy||finished} onChange={e=>setDue(e.target.value)}/></label><p className="research-note">Applies to this selected send.</p>
      <div className="research-fields">{keys.map(key=>{const values=new Set(templates.filter(t=>usesField(t,key)).map(t=>t.defaults[key]));return <label key={key}>{fieldLabels[key]}<input maxLength={1000} value={Object.hasOwn(changes,key)?changes[key]:current(key)} placeholder={values.size>1?'Mixed values — unchanged':'Not set'} disabled={busy||finished||!workspace.canSave} onChange={e=>setChanges(old=>({...old,[key]:e.target.value}))}/></label>;})}</div>
      {error&&<p role="alert" className="research-error">{error}</p>}
      <div className="research-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="research-primary" disabled={busy||finished||(!changed&&!dueChanged)||changed&&!workspace.canSave}>{busy?'Saving…':'Save changes'}</button></div>
    </form>
  </dialog>;
}
