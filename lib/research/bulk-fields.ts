import { Conflict, InputError } from '../domain/types';
import { fieldLabels, usesField } from './template-fields';
import type { TemplateDraft } from './types';
/** Validate the whole batch before any writes; preserve template content, identity and markets. */
export function bulkFieldChanges(raw:unknown,templates:TemplateDraft[]):TemplateDraft[]{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Choose templates and fields.');
  const body=raw as Record<string,unknown>;
  if(Object.keys(body).some(k=>!['templates','fields'].includes(k))||!Array.isArray(body.templates)||!body.templates.length||body.templates.length>100)throw new InputError('Choose up to 100 templates.');
  if(!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields))throw new InputError('Choose fields to change.');
  const fields=Object.entries(body.fields);
  if(!fields.length||fields.some(([k,v])=>k==='deadline'||!Object.hasOwn(fieldLabels,k)||typeof v!=='string'||v.length>1000))throw new InputError('Choose valid template fields.');
  const seen=new Set<string>();
  const selected=body.templates.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['id','revision'].includes(k)))throw new InputError('Choose valid templates.');
    const t=templates.find(t=>t.id===item.id);
    if(!t||seen.has(t.id))throw new InputError('Choose each template once.');
    seen.add(t.id);
    if(!Number.isSafeInteger(item.revision)||item.revision!==t.revision)throw new Conflict(t.name+' changed. Close and reload before editing.');
    return t;
  });
  if(fields.some(([k])=>!selected.some(t=>usesField(t,k))))throw new InputError('A field is not used by these templates.');
  return selected.flatMap(t=>{
    const applicable=fields.filter(([k])=>usesField(t,k));
    return applicable.length?[{...t,defaults:{...t.defaults,...Object.fromEntries(applicable)}}]:[];
  });
}
