import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict } from '../domain/types';
import { StorageError } from '../store';
import { sourceTemplates } from './templates';
import { inlineTemplateSchedule } from './template-schedule';
import type { ResearchRepository } from './service';
import type { TemplateDraft, TemplateVersion } from './types';

function fail(error:{code?:string;message:string}):never {
  if(error.code==='PT409'||error.code==='40001')throw new Conflict('This template changed. Reload before saving.');
  throw new StorageError('Research storage is unavailable. Confirm the approved database setup.');
}
export class SupabaseResearchStore implements ResearchRepository {
  constructor(private db:SupabaseClient){}
  async listTemplates(){
    const {data,error}=await this.db.from('ff_research_templates').select('payload').order('id');
    if(error){
      if(['42P01','PGRST205'].includes(error.code))return {templates:sourceTemplates(),installed:false};
      fail(error);
    }
    const stored=(data??[]).map(r=>inlineTemplateSchedule(r.payload as TemplateDraft)),ids=new Set(stored.map(t=>t.id));
    return {templates:[...stored,...sourceTemplates().filter(t=>!ids.has(t.id))],installed:true};
  }
  async saveTemplate(template:TemplateDraft,expectedRevision:number,directoryRevision:number){
    const {data,error}=await this.db.rpc('ff_research_save_template',{p_template:template,p_expected_revision:expectedRevision,p_directory_revision:directoryRevision,p_publish:false});
    if(error)fail(error);return data as TemplateDraft;
  }
  async publishTemplate(template:TemplateDraft,expectedRevision:number,directoryRevision:number){
    const {data,error}=await this.db.rpc('ff_research_save_template',{p_template:template,p_expected_revision:expectedRevision,p_directory_revision:directoryRevision,p_publish:true});
    if(error)fail(error);return data as TemplateVersion;
  }
}
