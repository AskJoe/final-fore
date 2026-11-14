import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import type { MailPayload } from './delivery';
export type ReceivedMessage={id:string;messageId:string;from:string;to:string[];cc:string[];subject:string;text:string;html:string;headers:Record<string,string>;authentication:{dkim?:string;spf?:string;dmarc?:string}|null;attachments:{filename:string;content:string}[]};
export type RelayContext={conversationId:string;sarahEmail:string;from:string;replyDomain:string;externalToken:string;staffToken:string;recipient:{to:string;cc:string[]};lastVendorMessageId?:string;lastGmailMessageId?:string};
export type RelayAction='to-sarah'|'to-vendor'|'held'|'no-relay';
export function emailAddress(value:string):string {
  if(/[\r\n]/.test(value))return '';
  const angle=value.match(/^[^<>]*<([^<>]+)>\s*$/),address=(angle?angle[1]:value).trim().toLowerCase();
  return /^[^\s<>,@]+@[^\s<>,@]+\.[^\s<>,@]+$/.test(address)?address:'';
}
/** A DKIM pass alone can be for any signing domain; DMARC ties it to the From domain.
 * A reported DMARC result must pass. When the provider reports none, DKIM decides, as before. */
export function senderAuthenticated(message:Pick<ReceivedMessage,'authentication'>):boolean {
  const dmarc=message.authentication?.dmarc;
  return message.authentication?.dkim==='pass'&&(dmarc===undefined||dmarc===null||dmarc==='pass');
}
export function decideRelay(message:ReceivedMessage,route:'staff'|'external',context:RelayContext):{action:RelayAction;reason?:string}{
  const headers=Object.fromEntries(Object.entries(message.headers).map(([k,v])=>[k.toLowerCase(),v]));
  if(headers['auto-submitted']&&headers['auto-submitted'].toLowerCase()!=='no'||headers['x-final-fore-relay']||/^(bulk|junk|list)$/i.test(headers.precedence??''))return {action:'no-relay',reason:'Automatic message recorded without a reply.'};
  if(route==='external'){
    if(emailAddress(message.from)===context.sarahEmail.toLowerCase())return {action:'held',reason:'Staff reply arrived at the external address. Review before forwarding.'};
    return {action:'to-sarah'};
  }
  if(emailAddress(message.from)!==context.sarahEmail.toLowerCase()||!senderAuthenticated(message))return {action:'held',reason:'Sender authentication needs review.'};
  const staff=`staff-${context.staffToken}@${context.replyDomain}`;
  const unexpected=[...message.to,...message.cc].map(emailAddress).some(a=>a!==staff&&a!==context.sarahEmail.toLowerCase());
  if(unexpected)return {action:'held',reason:'Recipient changes need review in the app.'};
  return {action:'to-vendor'};
}
export function cleanEmailHtml(html:string):string {
  return sanitizeHtml(html,{allowedTags:['p','br','strong','b','em','i','u','ul','ol','li','table','thead','tbody','tr','td','th','blockquote','a','h1','h2','h3','hr','span','div','pre'],allowedAttributes:{a:['href','title']},allowedSchemes:['https','http','mailto'],allowProtocolRelative:false});
}
function stripStaffRouting(value:string,context:RelayContext){
  const escaped=context.replyDomain.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return value.replace(new RegExp(`staff-[a-f0-9]{64}@${escaped}`,'gi'),'research-reply-address').replaceAll(context.staffToken,'research-reply-address');
}
/** Names with address punctuation ("Doe, Jane") must be quoted; plain names are unchanged. */
function relayName(display:string){
  const name=display+' via Final Fore';
  return /[,;:@()[\]]/.test(display)?'"'+name+'"':name;
}
export function buildRelayPayload(message:ReceivedMessage,action:'to-sarah'|'to-vendor',context:RelayContext):MailPayload{
  let html=cleanEmailHtml(message.html),text=message.text||convert(html,{wordwrap:false,selectors:[{selector:'img',format:'skip'}]});
  const vendor=action==='to-vendor';
  if(vendor){html=stripStaffRouting(html,context);text=stripStaffRouting(text,context);}
  const parent=vendor?context.lastVendorMessageId:context.lastGmailMessageId;
  const headers:Record<string,string>={'X-Final-Fore-Relay':context.conversationId};
  if(parent){headers['In-Reply-To']=parent;headers.References=parent;}
  const display=(message.from.includes('<')?message.from.slice(0,message.from.indexOf('<')).trim():emailAddress(message.from)).replace(/["\\\r\n<>]/g,'').slice(0,120);
  return {from:vendor?context.from:`${relayName(display||'Rep')} <${emailAddress(context.from)}>`,to:vendor?[context.recipient.to]:[context.sarahEmail],cc:vendor?context.recipient.cc:[],subject:(/^re:/i.test(message.subject)?message.subject:'Re: '+message.subject).replace(/[\r\n]/g,' '),text,html:html||undefined,replyTo:`${vendor?'reply-'+context.externalToken:'staff-'+context.staffToken}@${context.replyDomain}`,headers,attachments:message.attachments};
}
