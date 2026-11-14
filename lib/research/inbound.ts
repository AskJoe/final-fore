import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Resend } from 'resend';
import { convert } from 'html-to-text';
import { StorageError } from '../store';
import { cleanEmailHtml, decideRelay, senderAuthenticated, buildRelayPayload, emailAddress, type ReceivedMessage, type RelayContext } from './relay';
import { hashToken, seal, unseal } from './secrets';
import { researchStorageError } from './queue-store';
import { RESEARCH_BUCKET, verifyStorageFile, type ResearchFile } from './uploads';
import { MAX_FILE_SIZE } from './portals';
import type { ResearchConfig } from './config';

export async function downloadProviderFile(url:string,limit=MAX_FILE_SIZE):Promise<Buffer>{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!['.resend.com','.cloudfront.net','.amazonaws.com'].some(s=>parsed.hostname.endsWith(s)))throw new Error('Unexpected provider download host.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.body)throw new Error('Provider file is not available; retry.');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Provider file exceeds the collection limit.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Provider file exceeds the collection limit.');}chunks.push(value);}
  return Buffer.concat(chunks);
}
async function putPrivate(db:SupabaseClient,path:string,bytes:Buffer,type:string){
  const {error}=await db.storage.from(RESEARCH_BUCKET).upload(path,bytes,{contentType:type,upsert:false});
  if(error&&String(error.statusCode)!=='409')throw new StorageError('Unable to retain the incoming file.');
}
export async function threadContext(db:SupabaseClient,resend:Resend,conversationId:string,key:Buffer):Promise<RelayContext>{
  const [{data:secret,error:se},{data:c,error:ce}]=await Promise.all([db.from('ff_research_secrets').select('ciphertext').eq('conversation_id',conversationId).single(),db.from('ff_research_conversations').select('recipient').eq('id',conversationId).single()]);if(se)researchStorageError(se);if(ce)researchStorageError(ce);
  const routing=unseal<{externalToken:string;staffToken:string;sarahEmail:string;from:string;replyDomain:string}>(secret.ciphertext,key);
  async function parent(leg:'vendor'|'gmail'){
    const {data:incoming,error}=await db.from('ff_research_messages').select('original_message_id').eq('conversation_id',conversationId).eq('author_kind',leg==='vendor'?'rep':'staff').eq('state','recorded').not('original_message_id','is',null).order('created_at',{ascending:false}).limit(1);if(error)researchStorageError(error);
    if(incoming?.[0]?.original_message_id)return incoming[0].original_message_id as string;
    const {data:sent,error:e}=await db.from('ff_research_deliveries').select('id,provider_id,rfc_message_id,ff_research_messages!inner(conversation_id)').eq('ff_research_messages.conversation_id',conversationId).eq('leg',leg).order('created_at',{ascending:false}).limit(1);if(e)researchStorageError(e);
    const delivery=sent?.[0];if(!delivery)return undefined;
    if(delivery.rfc_message_id)return delivery.rfc_message_id as string;
    if(!delivery.provider_id)return undefined;
    // Thread headers are best effort. A failed copy must never block capture or another delivery leg.
    let fetched;try{fetched=await resend.emails.get(delivery.provider_id,{signal:AbortSignal.timeout(10000)});}catch{return undefined;}
    if(fetched.error||!fetched.data?.message_id)return undefined;
    const {error:u}=await db.from('ff_research_deliveries').update({rfc_message_id:fetched.data.message_id}).eq('id',delivery.id);if(u)researchStorageError(u);return fetched.data.message_id;
  }
  return {...routing,conversationId,recipient:c.recipient,lastVendorMessageId:await parent('vendor'),lastGmailMessageId:await parent('gmail')};
}
export async function ingestReceivedEmail(db:SupabaseClient,resend:Resend,emailId:string,config:ResearchConfig,scan:(bytes:Buffer)=>Promise<boolean>){
  const existing=await db.from('ff_research_messages').select('id,state').eq('received_email_id',emailId).maybeSingle();if(existing.error)researchStorageError(existing.error);if(existing.data&&existing.data.state!=='processing')return;
  const fetched=await resend.emails.receiving.get(emailId,{html_format:'cid'},{signal:AbortSignal.timeout(30000)});if(fetched.error)throw new Error('Unable to retrieve incoming email.');
  const data=fetched.data;
  const routes=data.to.map(emailAddress).map(address=>address.match(new RegExp(`^(reply|staff)-([a-f0-9]{64})@${config.replyDomain.replace(/\./g,'\\.')}$`))).filter(m=>m!==null);
  if(routes.length!==1)throw new Error('Incoming email has no unique research reply address.');
  const route=routes[0]!,hash=hashToken(route[2]),column=route[1]==='staff'?'staff_reply_hash':'external_reply_hash';
  const {data:secret,error}=await db.from('ff_research_secrets').select('conversation_id').eq(column,hash).maybeSingle();if(error)researchStorageError(error);if(!secret)throw new Error('Incoming email is not linked to a research conversation.');
  const conversationId=secret.conversation_id;
  const {data:conversation,error:ce}=await db.from('ff_research_conversations').select('manifest,portal_state').eq('id',conversationId).single();if(ce)researchStorageError(ce);
  const message:ReceivedMessage={id:data.id,messageId:data.message_id,from:data.from,to:data.to,cc:data.cc??[],subject:data.subject,text:data.text||convert(cleanEmailHtml(data.html??''),{wordwrap:false}),html:data.html??'',headers:data.headers??{},authentication:(data as unknown as {authentication:ReceivedMessage['authentication']}).authentication??null,attachments:[]};
  const originalText=message.text;
  const captured=await db.rpc('ff_research_append_message',{p_conversation:conversationId,p_message:{authorKind:route[1]==='staff'?'staff':'rep',sender:message.from,subject:message.subject,text:originalText,html:cleanEmailHtml(message.html),messageId:message.messageId,receivedEmailId:emailId,state:'processing',attachmentIds:[],authentication:message.authentication},p_deliveries:[]});if(captured.error)researchStorageError(captured.error);
  const context=await threadContext(db,resend,conversationId,config.secretKey);
  const decision=decideRelay(message,route[1]==='staff'?'staff':'external',context);
  // Record metadata/content even when reply authorization is held. No forged header can authorize forwarding.
  const references=[...new Set(Object.entries(message.headers).filter(([k])=>['references','in-reply-to'].includes(k.toLowerCase())).flatMap(([,v])=>v.match(/<[^>]+>/g)??[]))];
  if(references.length>100){decision.action='held';decision.reason='Reply history is too long to verify automatically.';}
  else if(references.length){
    const results=await Promise.all([
      db.from('ff_research_messages').select('conversation_id,original_message_id,state').in('original_message_id',references).limit(101),
      db.from('ff_research_deliveries').select('rfc_message_id,ff_research_messages!inner(conversation_id)').in('rfc_message_id',references).limit(101),
    ]);for(const r of results)if(r.error)researchStorageError(r.error);
    const incoming=results[0].data??[],outgoing=results[1].data??[];
    const outgoingOwner=(r:typeof outgoing[number])=>(r.ff_research_messages as unknown as {conversation_id:string}).conversation_id;
    if(incoming.some(r=>r.conversation_id!==conversationId)||outgoing.some(r=>outgoingOwner(r)!==conversationId)){decision.action='held';decision.reason='Reply references another research conversation.';}
    else if(route[1]==='staff'){
      const known=new Set([...incoming.filter(r=>r.state==='recorded').map(r=>r.original_message_id),...outgoing.map(r=>r.rfc_message_id)]);
      const direct=Object.entries(message.headers).filter(([k])=>k.toLowerCase()==='in-reply-to').flatMap(([,v])=>v.match(/<[^>]+>/g)??[]);
      if(direct.some(id=>!known.has(id))){decision.action='held';decision.reason='Reply thread could not be verified. Review this reply in the app.';}
    }
  }
  let rawObjectKey:string|null=null;
  if(data.raw?.download_url){const raw=await downloadProviderFile(data.raw.download_url);rawObjectKey=`${conversationId}/raw/${emailId}.eml`;await putPrivate(db,rawObjectKey,raw,'message/rfc822');}
  const attachmentIds:string[]=[];
  for(const attachment of data.attachments){
    const sourceId=emailId+'/'+attachment.id;
    const downloaded=await resend.emails.receiving.attachments.get({emailId,id:attachment.id},{signal:AbortSignal.timeout(30000)});if(downloaded.error)throw new Error('Unable to retrieve incoming attachment.');const bytes=await downloadProviderFile(downloaded.data.download_url);
    const name=(attachment.filename??`attachment-${attachment.id}`).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,240)||'attachment';
    const reserved=await db.rpc('ff_research_reserve_attachment',{p_conversation:conversationId,p_source:sourceId,p_market:conversation.manifest.markets.length===1?conversation.manifest.markets[0].marketId:null,p_name:name,p_size:bytes.length,p_hash:createHash('sha256').update(bytes).digest('hex'),p_type:attachment.content_type,p_uploader:message.from});if(reserved.error)researchStorageError(reserved.error);
    let file=reserved.data as ResearchFile;
    // Reservation precedes object storage so retrying never creates new orphan paths.
    if(file.state==='checking')await putPrivate(db,file.object_key,bytes,attachment.content_type);
    if(!attachmentIds.includes(file.id))attachmentIds.push(file.id);
    if(file.state==='checking'){await verifyStorageFile(db,file.id,scan);const fresh=await db.from('ff_research_files').select('*').eq('id',file.id).single();if(fresh.error)researchStorageError(fresh.error);file=fresh.data as ResearchFile;}
    if(file.state==='ready')message.attachments.push({filename:name,content:bytes.toString('base64')});
    else message.text+='\n\nAttachment retained for review: '+file.name;
  }
  let dispatch:{leg:string;ciphertext:string}[]=[];
  if(decision.action==='to-sarah'||decision.action==='to-vendor'){
    const mail=buildRelayPayload(message,decision.action,context);
    if(message.attachments.reduce((n,a)=>n+a.content.length,0)>35*1024*1024){
      if(decision.action==='to-sarah'){mail.attachments=[];mail.text+='\n\nFiles are retained in Final Fore: '+config.origin+'/research/'+conversationId;mail.html=undefined;dispatch=[{leg:'gmail',ciphertext:seal(mail,config.secretKey)}];}
      else {decision.action='held';decision.reason='Attachments exceed the email delivery limit. Files are retained in the app.';}
    }
    else dispatch=[{leg:decision.action==='to-sarah'?'gmail':'vendor',ciphertext:seal(mail,config.secretKey)}];
  }
  if(decision.action==='held'&&route[1]==='staff'&&emailAddress(message.from)===context.sarahEmail&&senderAuthenticated(message)){
    dispatch=[{leg:'gmail',ciphertext:seal({from:context.from,to:[context.sarahEmail],cc:[],replyTo:`staff-${context.staffToken}@${context.replyDomain}`,subject:'Reply not sent: '+message.subject.replace(/[\r\n]/g,' '),text:(decision.reason??'This reply needs review.')+'\n\nOpen the conversation: '+config.origin+'/research/'+conversationId,headers:{'Auto-Submitted':'auto-generated','X-Final-Fore-Relay':conversationId}},config.secretKey)}];
  }
  const saved=await db.rpc('ff_research_append_message',{p_conversation:conversationId,p_message:{authorKind:route[1]==='staff'?'staff':'rep',sender:message.from,subject:message.subject,text:originalText,html:cleanEmailHtml(message.html),messageId:message.messageId,receivedEmailId:emailId,state:decision.action==='held'?'held':'recorded',holdReason:decision.reason??null,attachmentIds,rawObjectKey,authentication:message.authentication},p_deliveries:dispatch});if(saved.error)researchStorageError(saved.error);
}
