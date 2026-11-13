import { requireMember } from '../access';
import { Service } from '../service';
import { SupabaseStore } from '../store';
import { MARKETS } from '../domain/catalogs';
import { SupabaseResearchStore } from './store';
import { marketChoices, validateTemplate } from './templates';
import { eligibleTemplates, isResearchRecipient, type AssignmentContext, type AssignmentOverride } from './assignments';
import { researchStorageError } from './queue-store';
import { researchSendEnabled, researchConfig } from './config';
import { researchTestOnly,testEmailIdentity } from './send-policy';

export async function loadResearchWorkspace(){
  const {supabase,user}=await requireMember();
  const repository=new SupabaseResearchStore(supabase);
  const [directory,source]=await Promise.all([new Service(new SupabaseStore(supabase)).directory(),repository.listTemplates()]);
  const assignments:AssignmentContext={overrides:[],directoryRevision:directory.record?.version??0};
  if(source.installed){const result=await supabase.from('ff_research_assignments').select('payload');if(result.error)researchStorageError(result.error);assignments.overrides=(result.data??[]).map(r=>r.payload as AssignmentOverride);}
  const testOnly=researchTestOnly();
  const testIdentity=testEmailIdentity(process.env.FINAL_FORE_RESEARCH_SARAH_EMAIL??'sarah@finalforemedia.com',testOnly,process.env.FINAL_FORE_RESEARCH_RESEND_TEST_ACCOUNT);
  let configured=false;try{researchConfig();configured=!!(process.env.RESEND_API_KEY&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)&&(testOnly||process.env.FINAL_FORE_RESEARCH_SCANNER_URL&&process.env.FINAL_FORE_RESEARCH_SCANNER_KEY));}catch{/* Setup previews remain available before external configuration. */}
  return {supabase,user,repository,directory,assignments,workspace:{
    templates:source.templates,
    installed:source.installed,
    canSave:source.installed&&process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED==='1',
    testOnly,
    testIdentity,
    canTestSend:source.installed&&configured&&researchSendEnabled()&&testOnly,
    canSend:source.installed&&configured&&researchSendEnabled()&&!testOnly,
    canPrepare:source.installed&&configured&&process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED==='1'&&!testOnly,
    previewRecipients:[...new Set([user.email,process.env.FINAL_FORE_RESEARCH_SARAH_EMAIL??'sarah@finalforemedia.com'].filter((e):e is string=>!!e))],
    issues:Object.fromEntries(source.templates.map(t=>[t.id,validateTemplate(t,directory.data,MARKETS)])),
    markets:marketChoices,
    reps:directory.data.reps.filter(isResearchRecipient).map(r=>({id:r.id,name:r.name,email:r.email,firmId:r.firmId,firmName:directory.data.firms.find(f=>f.id===r.firmId)?.name??'',choices:eligibleTemplates(r,directory.data,source.templates,assignments).map(c=>({...c,revision:assignments.overrides.find(a=>a.repId===r.id&&a.templateId===c.templateId)?.revision??0}))})),
  }};
}
export type ResearchWorkspace = Awaited<ReturnType<typeof loadResearchWorkspace>>['workspace'];
