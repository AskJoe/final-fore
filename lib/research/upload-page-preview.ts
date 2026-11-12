import {escapeEmailText} from './email-format';
import type {PreviewInput} from './types';
import {requestOrigin} from '../request-origin';
/** Preserve the browser-facing host/port, including a custom local server port. */
export function previewRequestOrigin(request:Request){
  return requestOrigin(request);
}
/** Staff-only preview route. No public token or collection is created by inspection. */
export function uploadPagePreviewUrl(input:PreviewInput,origin:string){
  const url=new URL('/research-upload/preview',origin);
  url.search=new URLSearchParams({templateId:input.templateId,repId:input.repId,deadline:input.deadline}).toString();
  return url.href;
}
/** Change only preview navigation; prepared provider payloads and hashes remain untouched. */
export function uploadLinkPreviewHtml(html:string,url:string){
  return html.replace(/<a href="[^"]*">/g,()=>'<a href="'+escapeEmailText(url)+'" target="_blank" rel="noopener noreferrer" title="Preview upload page">');
}
