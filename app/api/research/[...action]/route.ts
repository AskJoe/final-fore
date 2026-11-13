import { failure, json, sameOrigin } from '@/lib/http';
import { InputError } from '@/lib/domain/types';
import { MARKETS } from '@/lib/domain/catalogs';
import { loadResearchWorkspace } from '@/lib/research/workspace';
import { bulkFieldChanges } from '@/lib/research/bulk-fields';
import { ResearchService } from '@/lib/research/service';
import { parsePreviewInput, parseTemplatePreviewInput, renderEmail } from '@/lib/research/render';
import { uploadPagePreviewUrl, uploadLinkPreviewHtml, previewRequestOrigin } from '@/lib/research/upload-page-preview';
import { inspectTemplate } from '@/lib/research/template-inspection';
import { recipientGroups, makeAssignment, isResearchContact, sourceCc } from '@/lib/research/assignments';
import type { TemplateDraft, TemplateVersion } from '@/lib/research/types';
import { researchAdmin, researchConfig, researchWritesEnabled } from '@/lib/research/config';
import { prepareRequest, queuePrepared } from '@/lib/research/requests';
import { SupabaseRequestRepository, researchStorageError } from '@/lib/research/queue-store';
import { requireMember } from '@/lib/access';
import { ResearchInbox } from '@/lib/research/inbox';
import { startUploadTest } from '@/lib/research/upload-test';
import { sendPreviewCopy } from '@/lib/research/preview-send';
import { queueTestEmail } from '@/lib/research/test-send';
import { researchTestOnly } from '@/lib/research/send-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string[]}>};

export async function GET(request:Request,context:Context){
  const action=(await context.params).action.join('/');
  try{
    if(action==='workspace')return json((await loadResearchWorkspace()).workspace);
    if(action==='template-preview'){
      const {workspace,directory,assignments}=await loadResearchWorkspace();
      const input=parseTemplatePreviewInput(Object.fromEntries(new URL(request.url).searchParams));
      const template=workspace.templates.find(t=>t.id===input.templateId);if(!template)throw new InputError('Choose a template.');
      const recipient=recipientGroups([input],directory.data,workspace.templates,assignments)[0];
      return json({email:inspectTemplate(template,recipient,input.deadline,uploadPagePreviewUrl(input,previewRequestOrigin(request))),recipient});
    }
    const {user}=await requireMember();
    if(!['threads','thread','files','files/download'].includes(action))return json({error:'Not found.'},404);
    if(!researchWritesEnabled())return json({enabled:false,conversations:[],groups:[],next:null});
    const inbox=new ResearchInbox(researchAdmin(),user.id),params=new URL(request.url).searchParams;
    if(action==='threads')return json({enabled:true,...await inbox.list(params.get('before')??undefined)});
    if(action==='files')return json({enabled:true,...await inbox.incoming(params.get('before')??undefined)});
    if(action==='thread')return json({enabled:true,...await inbox.thread(params.get('id')??'')});
    return new Response(null,{status:302,headers:{Location:await inbox.download(params.get('id')??''),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  }catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
  const action=(await context.params).action.join('/');
  if(!['send-test','upload-test','preview','preview-batch','templates/save','templates/bulk-fields','templates/publish','templates/copy','assignments/confirm','send','send-preview','reply','read','files/assign','portal/state'].includes(action))return json({error:'Not found.'},404);
  if(!sameOrigin(request))return json({error:'Use this app to save changes.'},403);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'Expected JSON.'},415);
  try{
    const {workspace,repository,directory,user,supabase,assignments}=await loadResearchWorkspace();
    const reader=request.body?.getReader();if(!reader)throw new InputError('Expected a request body.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>150000){await reader.cancel();return json({error:'Request is too large.'},413);}chunks.push(value);}
    const body=JSON.parse(Buffer.concat(chunks).toString());
    if(!body||typeof body!=='object'||Array.isArray(body))throw new InputError('Expected a JSON object.');
    if(researchTestOnly()&&['send','send-preview','reply'].includes(action))return json({error:'Test mode: vendor sends and automatic copies are blocked. Enter test addresses in the email preview.'},403);
    if(action==='send-test'){
      if(!workspace.canTestSend)return json({error:'Test email sending is not enabled.'},503);
      if(Object.keys(body).some(k=>!['templateId','repId','deadline','renderHash','testRecipients','idempotencyKey'].includes(k)))throw new InputError('Unknown test send field.');
      const input=parsePreviewInput({templateId:body.templateId,repId:body.repId,deadline:body.deadline}),template=workspace.templates.find(t=>t.id===input.templateId);
      if(!template)throw new InputError('Choose a template.');
      const recipient=recipientGroups([input],directory.data,workspace.templates,assignments)[0];
      return json(await queueTestEmail(researchAdmin(),user.id,template,recipient,input.deadline,body,uploadPagePreviewUrl(input,previewRequestOrigin(request)),researchConfig()));
    }
    if(action==='upload-test'){
      if(!workspace.canSave)return json({error:'Research storage is not enabled.'},503);
      const input=parseTemplatePreviewInput(body),template=workspace.templates.find(t=>t.id===input.templateId);
      if(!template)throw new InputError('Choose a template.');
      const recipient=recipientGroups([input],directory.data,workspace.templates,assignments)[0];
      return json(await startUploadTest(researchAdmin(),user.id,template,recipient,input.deadline));
    }
    if(action==='assignments/confirm'){
      if(!workspace.canSave)return json({error:'Research storage is not enabled.'},503);
      if(Object.keys(body).some(k=>!['repId','templateId','confirmed','revision'].includes(k)))throw new InputError('Unknown confirmation field.');
      const rep=directory.data.reps.find(r=>r.id===body.repId&&isResearchContact(r)),template=workspace.templates.find(t=>t.id===body.templateId);
      if(!rep||!template||!Number.isSafeInteger(body.revision)||body.revision<0)throw new InputError('Choose a rep and saved template.');
      const choices=workspace.reps.find(r=>r.id===rep.id)?.choices;
      if(!choices?.some(choice=>choice.templateId===template.id&&choice.canEditCoverage))throw new InputError('Choose an editable template that matches this rep’s directory coverage.');
      if(template.revision===0)throw new InputError('Save this template before confirming coverage.');
      const existing=assignments.overrides.find(a=>a.repId===rep.id&&a.templateId===template.id);
      const assignment=makeAssignment(rep,template,assignments.directoryRevision,body.confirmed,existing?.cc??sourceCc(rep));
      const {error}=await supabase.rpc('ff_research_confirm_assignment',{p_assignment:assignment,p_expected_revision:body.revision});if(error)researchStorageError(error);
      return json({saved:true});
    }
    if(['reply','read','files/assign','portal/state'].includes(action)){
      if(!researchWritesEnabled())return json({error:'Research storage is not enabled.'},503);
      const inbox=new ResearchInbox(researchAdmin(),user.id);
      const allowed:Record<string,string[]>={reply:['conversationId','idempotencyKey','text'],read:['conversationId','through'],'files/assign':['fileId','marketId'],'portal/state':['conversationId','state']};
      if(Object.keys(body).some(k=>!allowed[action].includes(k)))throw new InputError('Unknown request field.');
      if(action==='reply')return json(await inbox.reply(body));
      if(action==='read')await inbox.read(body.conversationId,body.through);
      if(action==='files/assign')await inbox.assign(body.fileId,body.marketId);
      if(action==='portal/state')await inbox.close(body.conversationId,body.state);
      return json({saved:true});
    }
    async function previewOne(raw:unknown){
      const input=parsePreviewInput(raw),template=workspace.templates.find(t=>t.id===input.templateId);
      if(!template)throw new InputError('Choose a template.');
      const recipient=recipientGroups([input],directory.data,workspace.templates,assignments)[0];
      const uploadPreviewUrl=uploadPagePreviewUrl(input,previewRequestOrigin(request));
      if(workspace.canPrepare&&template.status==='published'){
        const {data,error}=await supabase.from('ff_research_template_versions').select('payload').eq('template_id',template.id).order('version',{ascending:false}).limit(1);if(error)researchStorageError(error);
        if(!data?.[0])throw new InputError('Publish this template before sending.');
        const prepared=await prepareRequest(input,data[0].payload as TemplateVersion,directory.data,directory.record?.version??0,user.id,new SupabaseRequestRepository(researchAdmin()),researchConfig(),new Date(),assignments);
        return {email:prepared.email,previewHtml:uploadLinkPreviewHtml(prepared.email.html,uploadPreviewUrl),recipient,templateName:template.name,previewId:prepared.id,setupPreview:false};
      }
      const email=renderEmail(template,recipient,{deadline:input.deadline},uploadPreviewUrl);
      return {email,previewHtml:uploadLinkPreviewHtml(email.html,uploadPreviewUrl),recipient,templateName:template.name,setupPreview:true};
    }
    if(action==='preview')return json(await previewOne(body));
    if(action==='preview-batch'){
      if(Object.keys(body).some(k=>!['selections','deadline'].includes(k))||!Array.isArray(body.selections)||body.selections.length<1||body.selections.length>100)throw new InputError('Choose up to 100 recipients. Markets belong to templates.');
      const inputs=body.selections.map((s:unknown)=>{if(!s||typeof s!=='object'||Array.isArray(s))throw new InputError('Choose valid recipients.');return parsePreviewInput({...s,deadline:body.deadline});});
      const groups=recipientGroups(inputs,directory.data,workspace.templates,assignments),previews=[];
      for(const group of groups)previews.push(await previewOne({templateId:group.templateId,repId:group.repId,deadline:body.deadline}));
      return json({previews});
    }
    if(action==='send'){
      if(!workspace.canSend)return json({error:'Email sending is not enabled. No email was sent.'},503);
      return json(await queuePrepared(body,user.id,new SupabaseRequestRepository(researchAdmin()),workspace.canSend));
    }
    if(action==='send-preview'){
      if(!workspace.canSend)return json({error:'Email sending is not enabled. No email was sent.'},503);
      return json(await sendPreviewCopy(body,researchAdmin(),user.id,user.email??'',researchConfig()));
    }
    const service=new ResearchService(repository,directory.data,directory.record?.version??0,MARKETS,workspace.canSave);
    if(action==='templates/bulk-fields'){
      const changes=bulkFieldChanges(body,workspace.templates),saved:TemplateDraft[]=[],failed:{id:string;name:string;error:string}[]=[];
      for(const template of changes){
        try{saved.push(await service.save(template,template.revision));}
        catch(error){failed.push({id:template.id,name:template.name,error:error instanceof Error?error.message:'Unable to save.'});}
      }
      return json({saved,failed});
    }
    if(action==='templates/copy')return json({template:await service.copy(body.templateId,body.revision)});
    if(action==='templates/save')return json({template:await service.save(body.template as TemplateDraft,body.revision)});
    return json({version:await service.publish(body.templateId,body.revision)});
  }catch(e){return failure(e);}
}
