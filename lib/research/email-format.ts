import source from '../../data/research-template-formatting.json';
import type { TemplateDraft } from './types';

type TextStyle={bold?:boolean;italic?:boolean;underline?:boolean;color?:string};
type Run=TextStyle&{text:string};
type Paragraph={text:string;runs:Run[];level?:number;marker?:TextStyle};
export const escapeEmailText=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function styled(html:string,s:TextStyle){
  if(s.bold)html='<strong>'+html+'</strong>';
  if(s.italic)html='<em>'+html+'</em>';
  if(s.underline)html='<u>'+html+'</u>';
  return s.color&&/^#[0-9a-f]{6}$/i.test(s.color)?'<span style="color:'+s.color+'">'+html+'</span>':html;
}
/** Formatting is matched to unmerged paragraph text, never to user-supplied HTML.
 * Changed/new paragraphs retain their current content; no stale source text is substituted.
 * The same presentation is used in inspection, preparation and provider payloads.
 */
export function formatEmailBody(template:TemplateDraft,merge:(text:string)=>string,portalUrl:string){
  const format=Object.values(source.templates).find(t=>t.media===template.media&&t.scope===template.scope);
  const known=new Map<string,Paragraph>((format?.paragraphs??[]).map(p=>[p.text,p]));
  const inline=(text:string)=>escapeEmailText(merge(text)).replaceAll(escapeEmailText(portalUrl),'<a href="'+escapeEmailText(portalUrl)+'">'+escapeEmailText(portalUrl)+'</a>').replaceAll('\n','<br>');
  const html:string[]=[],plain:string[]=[];let list=false,item=false,bullets=false,number=0;
  function closeItem(){if(bullets){html.push('</ul>');bullets=false;}if(item){html.push('</li>');item=false;}}
  function closeList(){closeItem();if(list){html.push('</ol>');list=false;}}
  for(const text of template.body.split('\n\n')){
    const p=known.get(text),content=p?p.runs.map(r=>styled(inline(r.text),r)).join(''):inline(text);
    if(p?.level===0){
      if(!list){html.push('<ol style="margin:24px 0;padding-left:36px">');list=true;number=0;}
      closeItem();number++;const color=p.marker?.color&&/^#[0-9a-f]{6}$/i.test(p.marker.color)?p.marker.color:'#333333';
      html.push('<li style="margin:18px 0 0;padding-left:6px;color:'+color+'"><span style="color:#000000">'+content+'</span>');item=true;plain.push(number+'. '+merge(text));
    }else if(p?.level===1&&item){
      if(!bullets){html.push('<ul style="list-style-type:circle;margin:12px 0 16px;padding-left:36px;color:#000000">');bullets=true;}
      html.push('<li style="margin:0;padding-left:3px">'+content+'</li>');plain.push('   ○ '+merge(text));
    }else{
      closeList();html.push('<p style="margin:0 0 16px">'+content+'</p>');plain.push(merge(text));
    }
  }
  closeList();
  return {html:'<div style="font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.4;color:#000000">'+html.join('\n')+'</div>',text:plain.join('\n\n')};
}
