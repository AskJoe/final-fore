// Local HTTP contract fixture. No database, external account, or real email transport.
// It exercises the app/SDK boundaries, not Postgres transactions or Storage RLS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { initial } from '../lib/domain/directory';
import { sourceTemplates } from '../lib/research/templates';

export async function startResearchFlowFixture(port:number){
  const owner='11111111-1111-4111-8111-111111111111',calls:string[]=[],tokens=new Set<string>(['fixture-service-key']);
  const user={id:owner,aud:'authenticated',role:'authenticated',email:'owner@example.test',email_confirmed_at:'2026-11-10T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-11-10T00:00:00Z'};
  const template=sourceTemplates().find(t=>t.id==='radio-single-lincoln')!;
  for(const k of Object.keys(template.defaults))if(!template.defaults[k])template.defaults[k]='Fixture value';
  template.status='published';template.revision=1;
  const version={...template,versionId:randomUUID(),version:1};
  const tables:Record<string,any[]>={ff_members:[{user_id:owner}],ff_records:[{id:'directory',kind:'directory',version:1,payload:initial(),updated_at:new Date().toISOString()}],ff_research_templates:[{id:template.id,revision:1,payload:template}],ff_research_template_versions:[{id:version.versionId,template_id:template.id,version:1,payload:version}]};
  for(const name of ['assignments','previews','conversations','secrets','messages','deliveries','files','reads','reply_operations','jobs','attachment_sources'])tables['ff_research_'+name]=[];
  const objects=new Map<string,Buffer>(),grants=new Map<string,string>(),uploads=new Map<string,{key:string;bytes:Buffer;length:number}>();
  const batches=new Map<string,any>(),previewCopies=new Map<string,any>();
  let pausePatches=false;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://127.0.0.1:'+port),path=url.pathname;calls.push(`${req.method} ${path}`);
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,HEAD,PATCH,OPTIONS');res.setHeader('Access-Control-Expose-Headers','Location,Upload-Offset,Upload-Length,Tus-Resumable');
    const send=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const read=async()=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);};
    try{
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(path==='/auth/v1/token'){
        const exp=Math.floor(Date.now()/1000)+3600,token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner,aud:'authenticated',role:'authenticated',exp})).toString('base64url')+'.fixture-signature';tokens.add(token);send({access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user});return;
      }
      if(path.startsWith('/storage/v1/upload/resumable')){
        if(path!=='/storage/v1/upload/resumable/sign'&&!path.startsWith('/storage/v1/upload/resumable/sign/')){send({message:'Signed grants require the signed TUS endpoint'},403);return;}
        const grant=grants.get(String(req.headers['x-signature']));if(!grant){send({message:'Invalid upload grant'},403);return;}
        res.setHeader('Tus-Resumable','1.0.0');
        if(req.method==='POST'){
          const metadata=Object.fromEntries(String(req.headers['upload-metadata']).split(',').map(x=>{const [key,value]=x.split(' ');return [key,Buffer.from(value??'','base64').toString()];}));assert.equal(metadata.bucketName,'research-files');assert.equal(metadata.objectName,grant);
          const id=randomUUID(),bytes=await read(),length=Number(req.headers['upload-length']);uploads.set(id,{key:grant,bytes,length});if(bytes.length===length)objects.set(grant,bytes);
          res.setHeader('Location',url.origin+'/storage/v1/upload/resumable/sign/'+id);res.setHeader('Upload-Offset',String(bytes.length));res.writeHead(201);res.end();return;
        }
        const upload=uploads.get(path.split('/').at(-1)!);if(!upload){res.writeHead(404);res.end();return;}
        assert.equal(upload.key,grant);
        if(req.method==='HEAD'){res.setHeader('Upload-Offset',String(upload.bytes.length));res.setHeader('Upload-Length',String(upload.length));res.writeHead(200);res.end();return;}
        if(req.method==='PATCH'){
          if(pausePatches){res.writeHead(503);res.end();return;}
          assert.equal(Number(req.headers['upload-offset']),upload.bytes.length);upload.bytes=Buffer.concat([upload.bytes,await read()]);if(upload.bytes.length===upload.length)objects.set(upload.key,upload.bytes);
          res.setHeader('Upload-Offset',String(upload.bytes.length));res.writeHead(204);res.end();return;
        }
      }
      if(!tokens.has(req.headers.authorization?.replace('Bearer ','')??'')){send({message:'Not authenticated'},401);return;}
      if(path==='/auth/v1/user'){send(user);return;}
      if(path.startsWith('/storage/v1/object/upload/sign/research-files/')){
        const key=path.slice('/storage/v1/object/upload/sign/research-files/'.length),token=randomUUID();grants.set(token,key);send({url:'/object/upload/sign/research-files/'+key+'?token='+token});return;
      }
      if(path.startsWith('/storage/v1/object/info/research-files/')){
        const bytes=objects.get(path.slice('/storage/v1/object/info/research-files/'.length));send(bytes?{size:bytes.length}:{statusCode:'404',error:'not_found',message:'Not found'},bytes?200:404);return;
      }
      if(path.startsWith('/storage/v1/object/research-files/')){
        if(req.method==='POST'){const key=path.slice('/storage/v1/object/research-files/'.length);objects.set(key,await read());send({Key:key});return;}
        const bytes=objects.get(path.slice('/storage/v1/object/research-files/'.length));if(!bytes){send({message:'Not found'},404);return;}res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(bytes);return;
      }
      if(path.startsWith('/rest/v1/rpc/')){
        const name=path.split('/').at(-1)!,p=JSON.parse((await read()).toString()),now=new Date().toISOString();
        if(name==='ff_research_claim_job'){send(null);return;}
        if(name==='ff_research_prepare_preview'){assert.equal(p.p_preview.memberId,owner);tables.ff_research_previews.push({id:p.p_preview.id,member_id:owner,payload:p.p_preview});send(null);return;}
        if(name==='ff_research_queue_batch'){
          if(batches.has(p.p_key)){send(batches.get(p.p_key));return;}
          const id=randomUUID(),ids:string[]=[];
          for(const ref of p.p_refs){const preview=tables.ff_research_previews.find(x=>x.id===ref.previewId)!.payload;assert.equal(preview.email.renderHash,ref.renderHash);assert.equal(preview.memberId,owner);assert.equal(preview.email.missing.length,0);
            tables.ff_research_conversations.push({id:preview.id,request_id:id,template_version_id:preview.versionId,manifest:preview.manifest,recipient:preview.recipient,mode:'live',portal_state:'open',created_at:now,updated_at:now});
            tables.ff_research_secrets.push({conversation_id:preview.id,portal_hash:preview.portalHash,external_reply_hash:preview.externalReplyHash,staff_reply_hash:preview.staffReplyHash,ciphertext:preview.secrets});
            const messageId=randomUUID();tables.ff_research_messages.push({id:messageId,conversation_id:preview.id,author_kind:'staff',sender:'Sarah',subject:preview.email.subject,body_text:preview.email.text,state:'recorded',attachment_ids:[],created_at:now});
            for(const leg of ['vendor','gmail'])tables.ff_research_deliveries.push({id:randomUUID(),message_id:messageId,leg,state:'queued',payload_ciphertext:preview.dispatch[leg],created_at:now});ids.push(preview.id);
          }const result={requestId:id,conversationIds:ids};batches.set(p.p_key,result);send(result);return;
        }
        if(name==='ff_research_queue_preview_copy'){
          if(previewCopies.has(p.p_key)){send(previewCopies.get(p.p_key));return;}const c=p.p_copy;assert.equal(c.memberId,owner);
          tables.ff_research_conversations.push({id:c.id,manifest:c.manifest,recipient:c.recipient,mode:'preview',portal_state:'open',expires_at:c.expiresAt,created_at:now,updated_at:now});tables.ff_research_secrets.push({conversation_id:c.id,portal_hash:c.portalHash,ciphertext:c.secrets});
          const result={conversationId:c.id,portalUrl:c.portalUrl};previewCopies.set(p.p_key,result);send(result);return;
        }
        if(name==='ff_research_reserve_file'){
          const c=tables.ff_research_conversations.find(x=>x.id===p.p_conversation)!;assert.equal(c.portal_state,'open');assert.ok(c.manifest.markets.some((m:any)=>m.marketId===p.p_market));
          const old=tables.ff_research_files.find(f=>f.conversation_id===c.id&&f.market_id===p.p_market&&f.sha256===p.p_hash&&f.source==='portal'&&!f.duplicate_of);if(old){send(old);return;}
          const id=randomUUID(),file={id,conversation_id:c.id,market_id:p.p_market,name:p.p_name,size:p.p_size,sha256:p.p_hash,content_type:p.p_type,object_key:c.id+'/'+id,state:'uploading',source:'portal',error:null,created_at:now,updated_at:now};tables.ff_research_files.push(file);send(file);return;
        }
        if(name==='ff_research_finalize_file'){const file=tables.ff_research_files.find(f=>f.id===p.p_file)!;assert.equal(file.conversation_id,p.p_conversation);assert.equal(objects.get(file.object_key)?.length,file.size);file.state='checking';file.updated_at=now;send(null);return;}
        if(name==='ff_research_verify_file'){const file=tables.ff_research_files.find(f=>f.id===p.p_file)!;file.state=p.p_state;file.error=p.p_error;file.updated_at=now;send(null);return;}
        if(name==='ff_research_mark_read'){tables.ff_research_reads.push({member_id:owner,conversation_id:p.p_conversation,read_at:p.p_through});send(null);return;}
        if(name==='ff_research_reserve_attachment'){
          const prior=tables.ff_research_attachment_sources.find(s=>s.source_id===p.p_source);let file=prior?tables.ff_research_files.find(f=>f.id===prior.file_id):tables.ff_research_files.find(f=>f.conversation_id===p.p_conversation&&f.market_id===p.p_market&&f.sha256===p.p_hash&&f.source==='email'&&!f.duplicate_of);
          if(!file){const id=randomUUID();file={id,conversation_id:p.p_conversation,market_id:p.p_market,name:p.p_name,size:p.p_size,sha256:p.p_hash,content_type:p.p_type,object_key:p.p_conversation+'/'+id,state:p.p_size?'checking':'held',source:'email',uploader:p.p_uploader,created_at:now,updated_at:now};tables.ff_research_files.push(file);}
          assert.equal(file.conversation_id,p.p_conversation);assert.equal(file.sha256,p.p_hash);if(!prior)tables.ff_research_attachment_sources.push({source_id:p.p_source,file_id:file.id,filename:p.p_name});send(file);return;
        }
        if(name==='ff_research_append_message'){
          const input=p.p_message,old=tables.ff_research_messages.find(m=>m.received_email_id===input.receivedEmailId);
          if(old&&old.state!=='processing'){send(old.id);return;}
          const row={id:old?.id??randomUUID(),conversation_id:p.p_conversation,author_kind:input.authorKind,sender:input.sender,subject:input.subject,body_text:input.text,body_html:input.html,original_message_id:input.messageId,received_email_id:input.receivedEmailId,state:input.state,hold_reason:input.holdReason,attachment_ids:input.attachmentIds??[],created_at:now};if(old)Object.assign(old,row);else tables.ff_research_messages.push(row);
          for(const d of p.p_deliveries)tables.ff_research_deliveries.push({id:randomUUID(),message_id:row.id,leg:d.leg,state:'queued',payload_ciphertext:d.ciphertext,created_at:now});send(row.id);return;
        }
        send({message:'Unexpected fixture RPC: '+name},400);return;
      }
      const name=path.replace('/rest/v1/',''),table=tables[name];if(!table){send({message:'Unexpected fixture request: '+path},400);return;}
      if(req.method==='POST'){const row=JSON.parse((await read()).toString());if(name==='ff_research_files'&&row.market_id!==null&&table.some(f=>f.conversation_id===row.conversation_id&&f.market_id===row.market_id&&f.sha256===row.sha256&&f.source===row.source&&!f.duplicate_of)){send({code:'23505',message:'Duplicate conversation/market/hash'},409);return;}table.push({...row,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});send(req.headers.accept?.includes('application/vnd.pgrst.object+json')?table.at(-1):[table.at(-1)]);return;}
      let rows=table.map(r=>({...r}));
      if(name==='ff_research_deliveries')rows=rows.map(r=>({...r,ff_research_messages:tables.ff_research_messages.find(m=>m.id===r.message_id)}));
      for(const [key,filter] of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;const readField=(r:any)=>key.split('.').reduce((v,k)=>v?.[k],r);if(filter.startsWith('eq.'))rows=rows.filter(r=>String(readField(r))===filter.slice(3));else if(filter.startsWith('lt.'))rows=rows.filter(r=>String(readField(r))<filter.slice(3));else if(filter.startsWith('neq.'))rows=rows.filter(r=>String(readField(r))!==filter.slice(4));else if(filter.startsWith('in.(')){const values=filter.slice(4,-1).split(',').map(x=>x.replaceAll('"',''));rows=rows.filter(r=>values.includes(String(readField(r))));}else if(filter==='is.null')rows=rows.filter(r=>readField(r)==null);else if(filter==='not.is.null')rows=rows.filter(r=>readField(r)!=null);else throw new Error('Fixture filter not implemented: '+key+' '+filter);}
      if(req.method==='PATCH'){const change=JSON.parse((await read()).toString());for(const row of rows)Object.assign(table.find(r=>r.id===row.id)!,change);send(rows);return;}
      const order=url.searchParams.get('order');if(order){rows.sort((a,b)=>{for(const rule of order.split(',')){const [field,dir,nulls]=rule.split('.');if(a[field]==null&&b[field]!=null)return nulls==='nullsfirst'?-1:1;if(b[field]==null&&a[field]!=null)return nulls==='nullsfirst'?1:-1;const diff=String(a[field]).localeCompare(String(b[field]))*(dir==='desc'?-1:1);if(diff)return diff;}return 0;});}
      if(url.searchParams.has('offset'))rows=rows.slice(Number(url.searchParams.get('offset')));
      if(url.searchParams.has('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));
      if(req.headers.accept?.includes('application/vnd.pgrst.object+json')){send(rows[0]??null);return;}send(rows);
    }catch(error){send({message:error instanceof Error?error.message:'Fixture error'},500);}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  return {url:'http://127.0.0.1:'+address.port,tables,objects,uploads,calls,pause:()=>{pausePatches=true;},resume:()=>{pausePatches=false;},expireUploads:()=>uploads.clear(),close:()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
