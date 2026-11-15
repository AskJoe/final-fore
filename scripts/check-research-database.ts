/** Explicitly approved local integration check. Never sends mail or contacts a remote host. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Upload, DetailedError } from 'tus-js-client';
import { MARKETS } from '../lib/domain/catalogs';
import { ResearchService } from '../lib/research/service';
import { SupabaseResearchStore } from '../lib/research/store';
import { SupabaseRequestRepository, SupabaseDeliveryRepository } from '../lib/research/queue-store';
import { prepareRequest, queuePrepared, type PreparedPreview } from '../lib/research/requests';
import { makeAssignment } from '../lib/research/assignments';
import { processDelivery } from '../lib/research/delivery';
import { ResearchUploads, RESEARCH_BUCKET } from '../lib/research/uploads';
import { ResearchInbox } from '../lib/research/inbox';
import { buildPreviewCopy } from '../lib/research/preview-send';
import { unseal } from '../lib/research/secrets';

async function main(){
  assert.equal(process.env.FINAL_FORE_APPROVED_LOCAL_RESEARCH_TEST,'1','Requires the approved local integration run.');
  assert.match(fs.readFileSync('supabase/config.toml','utf8'),/project_id = "final-fore-local"/);
  process.env.FINAL_FORE_RESEARCH_SEND_ENABLED='0';process.env.FINAL_FORE_RESEARCH_WRITES_ENABLED='1';
  const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',env:{...process.env,DOCKER_CONTEXT:'desktop-linux',SUPABASE_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']}));assert.equal(status.API_URL,'http://127.0.0.1:54321');
  const originalFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:input.toString());assert.equal(url.hostname,'127.0.0.1','External requests forbidden in local integration checks.');assert.equal(url.port,'54321');return originalFetch(input,init);};
  const options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),anon=createClient(status.API_URL,status.PUBLISHABLE_KEY||status.ANON_KEY,options);
  const runId=randomUUID(),password=randomBytes(24).toString('hex'),members:string[]=[],templateIds:string[]=[],previews:PreparedPreview[]=[],conversationIds:string[]=[],requestIds:string[]=[],jobIds:string[]=[],eventIds:string[]=[],previewOperationIds:string[]=[],checks:string[]=[];
  const reportPath='.local-migration/research-database-checks.json';
  const ok=(name:string)=>{checks.push(name);console.log('PASS '+name);};
  function checked<R extends {data:unknown;error:unknown}>(result:R):NonNullable<R['data']>{if(result.error)throw new Error(JSON.stringify(result.error));return result.data as NonNullable<R['data']>;}
  const before=checked(await admin.from('ff_records').select('*').order('id'));
  const directoryRow=before.find(r=>r.id==='directory');assert.ok(directoryRow);
  const directory=structuredClone(directoryRow.payload),jake=directory.reps.find((r:any)=>r.name==='Jake Sorensen');assert.ok(jake);
  // Mask transport addresses only in this isolated test input. The persisted vendor directory is never edited.
  jake.email='vendor@example.test';jake.name='Local integration rep';
  const config={origin:'http://127.0.0.1:3000',replyDomain:'research.example.test',from:'Research Test <research@example.test>',sarahEmail:'staff@example.test',secretKey:randomBytes(32)};
  let failure:unknown;
  try{
    for(const member of [true,false]){const created=checked(await admin.auth.admin.createUser({email:`research-${runId}-${member?'member':'outsider'}@example.test`,password,email_confirm:true}));assert.ok(created.user);members.push(created.user.id);if(member)checked(await admin.from('ff_members').insert({user_id:created.user.id}));}
    const member=createClient(status.API_URL,status.PUBLISHABLE_KEY||status.ANON_KEY,options),outsider=createClient(status.API_URL,status.PUBLISHABLE_KEY||status.ANON_KEY,options),member2=createClient(status.API_URL,status.PUBLISHABLE_KEY||status.ANON_KEY,options);
    for(const [client,email] of [[member,`research-${runId}-member@example.test`],[member2,`research-${runId}-member@example.test`],[outsider,`research-${runId}-outsider@example.test`]] as [SupabaseClient,string][])checked(await client.auth.signInWithPassword({email,password}));
    const denied=await anon.from('ff_research_templates').select('id');assert.ok(denied.error);
    assert.deepEqual(checked(await outsider.from('ff_research_templates').select('id')),[]);
    assert.ok((await member.rpc('ff_research_queue_batch',{p_member:members[0],p_key:randomUUID(),p_refs:[]})).error,'Private outbox function must be denied to a browser member.');
    ok('anonymous/nonmember isolation and server-only outbox permissions');
    const repo=new SupabaseResearchStore(member),service=new ResearchService(repo,directory,directoryRow.version,MARKETS,true);
    let template=await service.copy('radio-single-lincoln',0);templateIds.push(template.id);
    for(const key of Object.keys(template.defaults))if(!template.defaults[key])template.defaults[key]='Local integration fixture';
    template=await service.save({...template,name:'LOCAL INTEGRATION — '+runId},template.revision);
    let version=await service.publish(template.id,template.revision);
    assert.equal(version.markets[0].marketId,'epic3-lincoln');assert.equal(version.markets.length,1);
    assert.deepEqual(checked(await outsider.from('ff_research_templates').select('id')),[]);
    assert.ok((await outsider.rpc('ff_research_save_template',{p_template:template,p_expected_revision:version.revision,p_directory_revision:directoryRow.version,p_publish:false})).error);
    const direct=await member.from('ff_research_templates').update({revision:999}).eq('id',template.id);assert.ok(direct.error);
    const invalid=await member.rpc('ff_research_save_template',{p_template:{...template,markets:[{marketId:'wrong-client-market',displayName:'Wrong market'}]},p_expected_revision:version.revision,p_directory_revision:directoryRow.version,p_publish:true});assert.equal(invalid.error?.code,'22023');
    const parallel=await Promise.allSettled([service.save({...template,name:'LOCAL INTEGRATION A'},version.revision),new ResearchService(new SupabaseResearchStore(member2),directory,directoryRow.version,MARKETS,true).save({...template,name:'LOCAL INTEGRATION B'},version.revision)]);
    assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(parallel.filter(r=>r.status==='rejected').length,1);
    const saved=(parallel.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<typeof template>).value;
    const immutable=checked(await admin.from('ff_research_template_versions').select('payload').eq('id',version.versionId).single());assert.deepEqual(immutable.payload,version);
    version=await service.publish(saved.id,saved.revision);ok('real publishing, market validation, immutable versions and concurrent stale-save rejection');
    const context={directoryRevision:directoryRow.version,overrides:[makeAssignment(jake,version,directoryRow.version,true,[])]},requests=new SupabaseRequestRepository(admin);
    for(let i=0;i<2;i++){const p=await prepareRequest({templateId:version.id,repId:jake.id,deadline:'2027-12-01'},version,directory,directoryRow.version,members[0],requests,config,new Date(),context);previews.push(p);assert.deepEqual(p.email.missing,[]);assert.deepEqual(unseal<any>(p.dispatch.vendor,config.secretKey).to,['vendor@example.test']);}
    const badKey=randomUUID(),bad=await admin.rpc('ff_research_queue_batch',{p_member:members[0],p_key:badKey,p_refs:[{previewId:previews[0].id,renderHash:previews[0].email.renderHash},{previewId:previews[1].id,renderHash:'0'.repeat(64)}]});assert.ok(bad.error);
    assert.deepEqual(checked(await admin.from('ff_research_requests').select('id').eq('operation_key',badKey)),[]);assert.deepEqual(checked(await admin.from('ff_research_conversations').select('id').in('id',previews.map(p=>p.id))),[]);
    const operation=randomUUID(),send={idempotencyKey:operation,previews:[{previewId:previews[0].id,renderHash:previews[0].email.renderHash}]};
    const queued=await Promise.all([queuePrepared(send,members[0],requests,true),queuePrepared(send,members[0],new SupabaseRequestRepository(admin),true)]);assert.equal(queued[0].requestId,queued[1].requestId);requestIds.push(queued[0].requestId);conversationIds.push(...queued[0].conversationIds);
    assert.equal(checked(await admin.from('ff_research_conversations').select('id').eq('request_id',queued[0].requestId)).length,1);ok('transaction rollback and concurrent duplicate send create no partial or duplicate conversations');
    const initialMessages=checked(await admin.from('ff_research_messages').select('id').eq('conversation_id',previews[0].id));const deliveryRows=checked(await admin.from('ff_research_deliveries').select('*').in('message_id',initialMessages.map(m=>m.id)));assert.equal(deliveryRows.length,2);
    let transportCalls=0;const fake={async send(payload:any){assert.ok(payload.to.every((address:string)=>address.endsWith('@example.test')));transportCalls++;return {id:randomUUID()};}};
    const deliveryId=deliveryRows.find(d=>d.leg==='vendor')!.id;
    const sent=await Promise.all([processDelivery(deliveryId,new SupabaseDeliveryRepository(admin,config.secretKey),fake,true),processDelivery(deliveryId,new SupabaseDeliveryRepository(admin,config.secretKey),fake,true)]);assert.equal(transportCalls,1);assert.ok(sent.includes('sent'));assert.ok(sent.includes('busy'));
    const delivered=checked(await admin.from('ff_research_deliveries').select('*').eq('id',deliveryId).single());
    checked(await admin.rpc('ff_research_apply_delivery_event',{p_provider:delivered.provider_id,p_type:'email.delivered',p_rfc_id:'<local-test@example.test>'}));checked(await admin.rpc('ff_research_apply_delivery_event',{p_provider:delivered.provider_id,p_type:'email.sent',p_rfc_id:null}));assert.equal(checked(await admin.from('ff_research_deliveries').select('state').eq('id',deliveryId).single()).state,'delivered');ok('database delivery leases and out-of-order event handling with an in-memory mail transport');
    const eventId='local-research-'+runId;eventIds.push(eventId);const events=await Promise.all([admin.rpc('ff_research_accept_event',{p_id:eventId,p_type:'email.sent',p_payload:{type:'email.sent',data:{email_id:delivered.provider_id}}}),admin.rpc('ff_research_accept_event',{p_id:eventId,p_type:'email.sent',p_payload:{type:'email.sent',data:{email_id:delivered.provider_id}}})]);assert.deepEqual(events.map(checked).sort(),[false,true]);jobIds.push(...checked(await admin.from('ff_research_jobs').select('id').eq('operation_key','event:'+eventId)).map(j=>j.id));ok('duplicate webhook event inserts one durable job');
    const copy=buildPreviewCopy(previews[0],'staff@example.test',`research-${runId}-member@example.test`,config),previewKey=randomUUID();previewOperationIds.push(previewKey);
    const previewCopy=checked(await admin.rpc('ff_research_queue_preview_copy',{p_member:members[0],p_key:previewKey,p_copy:copy}));conversationIds.push(previewCopy.conversationId);assert.equal(checked(await admin.from('ff_research_conversations').select('mode').eq('id',copy.id).single()).mode,'preview');
    const uploads=new ResearchUploads(admin),token=unseal<any>(previews[0].secrets,config.secretKey).portalToken,portal=await uploads.portal(token),bytes=Buffer.alloc(7*1024*1024,65),hash=createHash('sha256').update(bytes).digest('hex');
    const reservation=await uploads.reserve(token,{marketId:'epic3-lincoln',name:'local-integration.txt',size:bytes.length,sha256:hash});assert.ok(reservation.grant);const grant=reservation.grant;
    assert.ok((await anon.storage.from(RESEARCH_BUCKET).download(grant.objectKey)).error);
    assert.ok((await member.storage.from(RESEARCH_BUCKET).upload('unauthorized-'+runId,Buffer.from('no'))).error);
    let chunkCount=0;
    function transfer(payload:Buffer,headers:Record<string,string>,objectKey:string){return new Promise<void>((resolve,reject)=>{const upload=new Upload(payload,{endpoint:status.API_URL+'/storage/v1/upload/resumable/sign',headers,chunkSize:6*1024*1024,retryDelays:null,uploadDataDuringCreation:true,metadata:{bucketName:grant.bucket,objectName:objectKey,contentType:grant.contentType,cacheControl:'3600'},onChunkComplete:()=>chunkCount++,onError:reject,onSuccess:()=>resolve()});upload.start();});}
    const other=await uploads.reserve(token,{marketId:'epic3-lincoln',name:'other-local-file.txt',size:1,sha256:createHash('sha256').update('x').digest('hex')});assert.ok(other.grant);
    for(const [label,headers,path] of [
      ['missing token',{},grant.objectKey],
      ['invalid token',{'x-signature':'invalid-upload-token'},grant.objectKey],
      ['wrong-file token',{'x-signature':grant.token},other.grant.objectKey],
    ] as [string,Record<string,string>,string][]){
      await assert.rejects(transfer(Buffer.from('x'),headers,path),(error:unknown)=>error instanceof DetailedError&&[400,401,403].includes(error.originalResponse?.getStatus()??0),label+' must be rejected by Storage');
      assert.ok((await admin.storage.from(RESEARCH_BUCKET).info(path)).error,label+' must not create an object');
    }
    ok('signed TUS rejects missing, invalid and wrong-file tokens without creating objects');
    await transfer(bytes,{'x-signature':grant.token},grant.objectKey);
    assert.ok(chunkCount>=1);
    assert.equal((await uploads.finalize(token,reservation.file.id)).state,'ready');
    const uploadJobs=checked(await admin.from('ff_research_jobs').select('id').eq('operation_key','verify-file:'+reservation.file.id));
    assert.ok(uploadJobs.length<=1);
    assert.equal((await uploads.finalize(token,reservation.file.id)).state,'ready');
    assert.deepEqual(checked(await admin.from('ff_research_jobs').select('id').eq('operation_key','verify-file:'+reservation.file.id)),uploadJobs);
    const persisted=await new ResearchUploads(admin).files(await new ResearchUploads(admin).portal(token));assert.equal(persisted.find(f=>f.id===reservation.file.id)?.state,'ready');
    const url=await uploads.download(portal,reservation.file.id),download=await fetch(url);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
    const duplicate=await uploads.reserve(token,{marketId:'epic3-lincoln',name:'renamed.txt',size:bytes.length,sha256:hash});assert.equal(duplicate.file.id,reservation.file.id);assert.equal(duplicate.grant,null);
    await assert.rejects(uploads.reserve(token,{marketId:'epic3-austin',name:'wrong.txt',size:bytes.length,sha256:hash}),/market/i);
    const inbox=new ResearchInbox(admin,members[0]),incoming=await inbox.incoming();assert.ok(incoming.groups.some(g=>g.marketId==='epic3-lincoln'&&g.files.some(f=>f.id===reservation.file.id)));assert.ok(incoming.groups.every(g=>g.files.every(f=>f.conversationId!==copy.id)));
    ok('signed TUS, immediate availability, finalization dedup, scoped byte-identical Storage download and market ownership');
    const sourceA='local-attachment-'+runId+'-1',sourceB='local-attachment-'+runId+'-2',attachmentArgs={p_conversation:previews[0].id,p_market:'epic3-lincoln',p_name:'email-copy.txt',p_size:bytes.length,p_hash:hash,p_type:'text/plain',p_uploader:'staff@example.test'};
    const attachments=await Promise.all([admin.rpc('ff_research_reserve_attachment',{...attachmentArgs,p_source:sourceA}),admin.rpc('ff_research_reserve_attachment',{...attachmentArgs,p_source:sourceB})]);const a=checked(attachments[0]),b=checked(attachments[1]);assert.equal(a.id,b.id);assert.notEqual(a.id,reservation.file.id);assert.ok((await uploads.files(portal)).every(f=>f.id!==a.id));
    const unassigned=checked(await admin.rpc('ff_research_reserve_attachment',{...attachmentArgs,p_market:null,p_source:'local-attachment-'+runId+'-3'}));checked(await admin.rpc('ff_research_assign_file',{p_member:members[0],p_file:unassigned.id,p_market:'epic3-lincoln'}));assert.equal(checked(await admin.from('ff_research_files').select('duplicate_of').eq('id',unassigned.id).single()).duplicate_of,a.id);ok('concurrent attachment dedup, separate internal visibility and duplicate market assignment without deleting objects');
    checked(await admin.rpc('ff_research_set_portal_state',{p_member:members[0],p_conversation:previews[0].id,p_state:'closed'}));await assert.rejects(uploads.reserve(token,{marketId:'epic3-lincoln',name:'closed.txt',size:1,sha256:'a'.repeat(64)}),/closed/i);checked(await admin.rpc('ff_research_set_portal_state',{p_member:members[0],p_conversation:previews[0].id,p_state:'open'}));
    await assert.rejects(uploads.finalize(unseal<any>(copy.secrets,config.secretKey).portalToken,reservation.file.id),/belong/i);ok('closed collection and cross-portal authorization');
  }catch(error){failure=error;console.error('STOP: local integration check failed:',error instanceof Error?error.message:String(error));}
  finally{
    // Cleanup is authorized only for this run's recorded IDs. Never reset/drop/reseed or delete unrelated records.
    try{
      const ownConversations=checked(await admin.from('ff_research_conversations').select('id').in('created_by',members));conversationIds.push(...ownConversations.map(c=>c.id));const ids=[...new Set(conversationIds)];
      if(ids.length){
        const files=checked(await admin.from('ff_research_files').select('id,object_key').in('conversation_id',ids)),messages=checked(await admin.from('ff_research_messages').select('id').in('conversation_id',ids));
        if(files.length){checked(await admin.storage.from(RESEARCH_BUCKET).remove(files.map(f=>f.object_key)));checked(await admin.from('ff_research_attachment_sources').delete().in('file_id',files.map(f=>f.id)));checked(await admin.from('ff_research_jobs').delete().in('operation_key',files.map(f=>'verify-file:'+f.id)));checked(await admin.from('ff_research_files').delete().in('conversation_id',ids));}
        if(messages.length)checked(await admin.from('ff_research_deliveries').delete().in('message_id',messages.map(m=>m.id)));
        for(const table of ['ff_research_reply_operations','ff_research_preview_operations','ff_research_reads'])checked(await admin.from(table).delete().in('conversation_id',ids));
        checked(await admin.from('ff_research_messages').delete().in('conversation_id',ids));checked(await admin.from('ff_research_secrets').delete().in('conversation_id',ids));checked(await admin.from('ff_research_conversations').delete().in('id',ids));
      }
      if(jobIds.length)checked(await admin.from('ff_research_jobs').delete().in('id',jobIds));if(eventIds.length)checked(await admin.from('ff_research_events').delete().in('id',eventIds));
      if(members.length){checked(await admin.from('ff_research_requests').delete().in('member_id',members));checked(await admin.from('ff_research_previews').delete().in('member_id',members));}
      if(templateIds.length){checked(await admin.from('ff_research_assignments').delete().in('template_id',templateIds));checked(await admin.from('ff_research_template_versions').delete().in('template_id',templateIds));checked(await admin.from('ff_research_templates').delete().in('id',templateIds));}
      for(const member of members){checked(await admin.from('ff_members').delete().eq('user_id',member));checked(await admin.auth.admin.deleteUser(member));}
      assert.deepEqual(checked(await admin.from('ff_records').select('*').order('id')),before);ok('only integration test data cleaned; all existing application records unchanged');
    }catch(error){failure??=error;console.error('STOP: test cleanup failed:',error instanceof Error?error.message:String(error));}
    globalThis.fetch=originalFetch;
    fs.writeFileSync(reportPath,JSON.stringify({runId,checkedAt:new Date().toISOString(),target:status.API_URL,checks,success:!failure,realEmailsSent:0,existingRecords:before.length,remainingTestIds:failure?{members,templateIds,conversationIds,requestIds,jobIds,eventIds,previewOperationIds}:undefined},null,2),{mode:0o600});
  }
  if(failure)throw failure;
  console.log('PASS local PostgreSQL/Storage integration; no real email. Report: '+reportPath);
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
