import { renderEmail } from './render';
import type { Recipient, TemplateDraft } from './types';
import { uploadLinkPreviewHtml } from './upload-page-preview';
import { fieldLabels } from './template-fields';
export type TemplateInspection={subject:string;text:string;html:string;missing:string[]};
/** Display-only; does not prepare an email, create a collection or change send validation. */
export function inspectTemplate(template:TemplateDraft,recipient:Recipient,deadline:string,uploadUrl:string):TemplateInspection{
  const email=renderEmail(template,recipient,{deadline},uploadUrl);
  let {subject,text,html}=email;
  for(const key of email.missing){
    const label=fieldLabels[key]??key.replaceAll('_',' '),token='{{'+key+'}}',marker='['+label+' needed]';
    subject=subject.replaceAll(token,marker);text=text.replaceAll(token,marker);html=html.replaceAll(token,'<mark class="research-missing-value">'+label+' needed</mark>');
  }
  html=uploadLinkPreviewHtml(html,uploadUrl);
  return {subject,text,html,missing:email.missing.map(key=>fieldLabels[key]??key.replaceAll('_',' '))};
}
