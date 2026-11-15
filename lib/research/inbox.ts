import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { InputError } from '../domain/types';
import { StorageError } from '../store';
import { researchStorageError } from './queue-store';
import { groupIncomingFiles, parseReply, validateFileAssignment, type ConversationSummary } from './inbox-domain';
import { researchConfig, researchSendEnabled } from './config';
import { threadContext } from './inbound';
import { buildRelayPayload, type ReceivedMessage } from './relay';
import { seal } from './secrets';
import { RESEARCH_BUCKET, type ResearchFile } from './uploads';
import type { ResearchManifest } from './requests';
import type { BatchDelivery, Recipient } from './types';
import { readAll } from './read-all';
import { researchTestOnly } from './send-policy';
import { isStoredFileAvailable } from './file-status';

export type ResearchMessage={id:string;author_kind:'rep'|'staff'|'system';sender:string;subject:string;body_text:string;state:string;hold_reason:string|null;attachment_ids:string[];created_at:string};
export type DeliverySummary={id:string;message_id:string;leg:string;state:string;error:string|null};
export class ResearchInbox {
  constructor(private db:SupabaseClient,private memberId:string){}
  async batchStatus(id: string): Promise<BatchDelivery[]> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new InputError('Send batch not found.');
    const request = await this.db.from('ff_research_requests').select('id')
      .eq('id', id).eq('member_id', this.memberId).maybeSingle();
    if (request.error) researchStorageError(request.error);
    if (!request.data) throw new InputError('Send batch not found.');

    const conversations = await this.db.from('ff_research_conversations').select('id,recipient,created_at')
      .eq('request_id', id).eq('mode', 'live').order('id');
    if (conversations.error) researchStorageError(conversations.error);
    if (!conversations.data?.length) return [];
    const ids = conversations.data.map(row => row.id);
    const messages = await this.db.from('ff_research_messages').select('id,conversation_id,created_at')
      .in('conversation_id', ids).eq('author_kind', 'staff').order('created_at').order('id');
    if (messages.error) researchStorageError(messages.error);
    // The batch creates the first staff message for each new conversation.
    const initial = new Map<string, string>();
    for (const message of messages.data ?? []) {
      if (!initial.has(message.conversation_id)) initial.set(message.conversation_id, message.id);
    }
    const deliveries = await this.db.from('ff_research_deliveries').select('message_id,state,error')
      .eq('leg', 'vendor').in('message_id', [...initial.values()]);
    if (deliveries.error) researchStorageError(deliveries.error);
    const byMessage = new Map(deliveries.data?.map(row => [row.message_id, row]));
    return conversations.data.map(row => {
      const contact = row.recipient as Recipient;
      const delivery = byMessage.get(initial.get(row.id) ?? '');
      return {
        conversationId: row.id,
        recipient: contact.name,
        cc: contact.cc,
        state: (delivery?.state ?? 'queued') as BatchDelivery['state'],
        error: delivery?.error ?? null,
      };
    });
  }
  async list(before?:string,includeTests=false){
    let query=this.db.from('ff_research_conversations').select('*').order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(100);
    if(!includeTests)query=query.eq('mode','live');
    // ID is the tie breaker so concurrent same-timestamp batches cannot disappear between pages.
    if(before){const [at,id]=before.split('|');if(!Number.isFinite(Date.parse(at))||!/^[a-f0-9-]{36}$/i.test(id??''))throw new InputError('Invalid inbox page.');query=query.or(`updated_at.lt.${at},and(updated_at.eq.${at},id.lt.${id})`);}
    const {data:rows,error}=await query;if(error)researchStorageError(error);
    if(!rows?.length)return {conversations:[],next:null};
    const ids=rows.map(c=>c.id);
    const [messages,files,reads,deliveries]=await Promise.all([
      readAll(this.db.from('ff_research_messages').select('id,conversation_id,subject,state,created_at').in('conversation_id',ids).order('created_at').order('id')),
      readAll(this.db.from('ff_research_files').select('conversation_id,source,state').in('conversation_id',ids).is('duplicate_of',null).order('id')),
      this.db.from('ff_research_reads').select('conversation_id,read_at').eq('member_id',this.memberId).in('conversation_id',ids),
      readAll(this.db.from('ff_research_deliveries').select('state,ff_research_messages!inner(conversation_id)').in('ff_research_messages.conversation_id',ids).order('id')),
    ]);for(const r of [messages,files,reads,deliveries])if(r.error)researchStorageError(r.error);
    const conversations:ConversationSummary[]=rows.map(c=>{
      const ms=(messages.data??[]).filter(m=>m.conversation_id===c.id),fs=(files.data??[]).filter(f=>f.conversation_id===c.id),read=reads.data?.find(r=>r.conversation_id===c.id);
      const ds=(deliveries.data??[]).filter(d=>(d.ff_research_messages as unknown as {conversation_id:string}).conversation_id===c.id),states=ds.map(d=>d.state);
      return {id:c.id,mode:c.mode,manifest:c.manifest,recipient:c.recipient,portal_state:c.portal_state,created_at:c.created_at,updated_at:c.updated_at,subject:ms.at(-1)?.subject??c.manifest.templateName,unread:!read||c.updated_at>read.read_at,fileCount:fs.filter(isStoredFileAvailable).length,attention:ms.filter(m=>m.state==='held').length+fs.filter(f=>['held','failed'].includes(f.state)).length+states.filter(s=>['failed','bounced','needs-review'].includes(s)).length,deliveryState:states.some(s=>['failed','bounced','needs-review'].includes(s))?'Needs review':states.some(s=>['queued','sending','retry','uncertain'].includes(s))?'Sending':states.length?'Sent':''};
    });const last=rows.at(-1)!;return {conversations,next:rows.length===100?last.updated_at+'|'+last.id:null};
  }
  async conversation(id:string,includeTests=false){
    if(!/^[a-f0-9-]{36}$/i.test(id))throw new InputError('Conversation not found.');
    let query=this.db.from('ff_research_conversations').select('*').eq('id',id);if(!includeTests)query=query.eq('mode','live');
    const {data,error}=await query.maybeSingle();if(error)researchStorageError(error);if(!data)throw new InputError('Conversation not found.');
    return data as {id:string;manifest:ResearchManifest;recipient:Recipient;portal_state:string;updated_at:string};
  }
  async thread(id:string){
    const conversation=await this.conversation(id);
    const [messages,files,deliveries]=await Promise.all([
      readAll(this.db.from('ff_research_messages').select('id,author_kind,sender,subject,body_text,state,hold_reason,attachment_ids,created_at').eq('conversation_id',id).order('created_at').order('id')),
      readAll(this.db.from('ff_research_files').select('id,name,state,error,market_id,source,created_at').eq('conversation_id',id).order('created_at').order('id')),
      readAll(this.db.from('ff_research_deliveries').select('id,message_id,leg,state,error,ff_research_messages!inner(conversation_id)').eq('ff_research_messages.conversation_id',id).order('id')),
    ]);for(const r of [messages,files,deliveries])if(r.error)researchStorageError(r.error);
    return {conversation,messages:messages.data as ResearchMessage[],files:files.data??[],deliveries:(deliveries.data??[]).map(({id,message_id,leg,state,error})=>({id,message_id,leg,state,error})) as DeliverySummary[]};
  }
  async incoming(before?:string){
    // Page by conversation: preserve each manifest and avoid mixing equal city labels under different clients.
    const list=await this.list(before,true);if(!list.conversations.length)return {groups:[],next:null};
    const {data}=await readAll(this.db.from('ff_research_files').select('*').in('conversation_id',list.conversations.map(c=>c.id)).is('duplicate_of',null).order('created_at').order('id'));
    return {groups:groupIncomingFiles(list.conversations.map(c=>({...c,files:(data as ResearchFile[]).filter(f=>f.conversation_id===c.id)})),true),next:list.next};
  }
  async read(id:string,through:string){
    await this.conversation(id);if(!Number.isFinite(Date.parse(through))||Date.parse(through)>Date.now())throw new InputError('Invalid read time.');
    const {error}=await this.db.rpc('ff_research_mark_read',{p_member:this.memberId,p_conversation:id,p_through:through});if(error)researchStorageError(error);
  }
  async assign(fileId:string,marketId:unknown){
    const {data:file,error}=await this.db.from('ff_research_files').select('*').eq('id',fileId).maybeSingle();if(error)researchStorageError(error);if(!file)throw new InputError('File not found.');
    const c=await this.conversation(file.conversation_id),id=validateFileAssignment(file,marketId,c.manifest.markets);
    const {error:e}=await this.db.rpc('ff_research_assign_file',{p_member:this.memberId,p_file:fileId,p_market:id});if(e)researchStorageError(e);
  }
  async download(id:string){
    const {data:file,error}=await this.db.from('ff_research_files').select('conversation_id,object_key,name,source,state').eq('id',id).maybeSingle();if(error)researchStorageError(error);if(!file||!isStoredFileAvailable(file))throw new InputError('File is not ready.');await this.conversation(file.conversation_id,true);
    const signed=await this.db.storage.from(RESEARCH_BUCKET).createSignedUrl(file.object_key,30,{download:file.name});if(signed.error)throw new StorageError('Unable to open file.');return signed.data.signedUrl;
  }
  async close(id:string,state:unknown){
    await this.conversation(id);if(!['open','closed'].includes(String(state)))throw new InputError('Choose open or closed.');
    const {error}=await this.db.rpc('ff_research_set_portal_state',{p_member:this.memberId,p_conversation:id,p_state:state});if(error)researchStorageError(error);
  }
  async reply(raw:unknown){
    if(researchTestOnly())throw new InputError('Vendor replies are blocked during test mode.');
    if(!researchSendEnabled())throw new InputError('Email sending is disabled.');
    const input=parseReply(raw),c=await this.conversation(input.conversationId),config=researchConfig();
    const existing=await this.db.from('ff_research_reply_operations').select('message_id,body_text,conversation_id').eq('member_id',this.memberId).eq('operation_key',input.idempotencyKey).maybeSingle();if(existing.error)researchStorageError(existing.error);if(existing.data){if(existing.data.body_text!==input.text||existing.data.conversation_id!==c.id)throw new InputError('Reply operation changed.');return {messageId:existing.data.message_id};}
    const context=await threadContext(this.db,new Resend(process.env.RESEND_API_KEY),c.id,config.secretKey);
    const first=await this.db.from('ff_research_messages').select('subject').eq('conversation_id',c.id).order('created_at').limit(1);if(first.error)researchStorageError(first.error);
    const message:ReceivedMessage={id:input.idempotencyKey,messageId:'',from:config.sarahEmail,to:[],cc:[],subject:first.data?.[0]?.subject??c.manifest.templateName,text:input.text,html:'',headers:{},authentication:null,attachments:[]};
    const vendor=buildRelayPayload(message,'to-vendor',context),gmail=buildRelayPayload(message,'to-sarah',context);gmail.from=config.from;
    if(config.directReplies){vendor.replyTo=config.sarahEmail;gmail.replyTo=c.recipient.to;}
    const {data,error}=await this.db.rpc('ff_research_reply',{p_member:this.memberId,p_conversation:c.id,p_key:input.idempotencyKey,p_subject:vendor.subject,p_text:input.text,p_dispatch:{vendor:seal(vendor,config.secretKey),gmail:seal(gmail,config.secretKey)}});if(error)researchStorageError(error);return {messageId:data};
  }
}
