import type {Metadata} from 'next';
import {redirect,notFound} from 'next/navigation';
import {AccessError} from '@/lib/access';
import {InputError} from '@/lib/domain/types';
import {loadResearchWorkspace} from '@/lib/research/workspace';
import {parseTemplatePreviewInput} from '@/lib/research/render';
import {recipientGroups} from '@/lib/research/assignments';
import {findUploadTest,uploadTestKey} from '@/lib/research/upload-test';
import {researchAdmin} from '@/lib/research/config';
import PreviewClient from './PreviewClient';
import '../upload.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Upload page preview · Final Fore',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function UploadPreview({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  let data;
  try{data=await loadResearchWorkspace();}catch(e){if(e instanceof AccessError)redirect('/login'+(e.status===401?'':'?error='+encodeURIComponent(e.message)));throw e;}
  try{
    const input=parseTemplatePreviewInput(await searchParams),template=data.workspace.templates.find(t=>t.id===input.templateId);
    if(!template)throw new InputError('Choose a template.');
    const rep=recipientGroups([input],data.directory.data,data.workspace.templates,data.assignments)[0];
    const existing=data.workspace.canSave?await findUploadTest(researchAdmin(),data.user.id,uploadTestKey(template,rep,input.deadline)):null;
    return <PreviewClient input={input} enabled={data.workspace.canSave} existing={existing} storageUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!} firmName={rep.firmName} media={template.media} deadline={input.deadline} markets={template.markets}/>;
  }catch(e){if(e instanceof InputError)notFound();throw e;}
}
