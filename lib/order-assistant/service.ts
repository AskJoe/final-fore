import { createHmac,randomUUID } from 'node:crypto';
import { canonicalDigest as digest } from './digest';
import { projectDocument,projectLine,projectResearchPage } from './projection';
import { loadOrderArchive, loadOrderArchiveDigest } from '../orders/archive-source';
import assignments from '../../data/research-assignment-seed.json';
import { AccessError } from '../access';
import { check,Conflict } from '../domain/types';
import { MARKETS } from '../domain/catalogs';
import { StorageError } from '../store';
import type { OrderRuntime } from '../orders/runtime';
import { loadOrderResearch } from '../orders/research-service';
import { stateCommand } from '../orders/research-state';
import { orderLineAmount, orderTotal,type OrderDetail, type OrderLine } from '../orders/store';
import { archiveOrderSeed } from '../orders/sources';
import { orderVendorGroups } from '../orders/vendor-groups';
import { isBroadcastPlacement } from '../orders/metrics';
import { selectedResearchKeys } from '../orders/research-selection';
import mapping from '../../data/research-market-links.json';
import { buildOrderChanges,cleanOrderChanges } from './changes';
import { assertMarketContext,cleanResearchView,cleanStarUpdates,type MarketContext,type MarketProposal,
  type ResearchView,type RevisionStamp,type SourceVersions } from './types';

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function requireUuid(value:unknown):asserts value is string { check(uuid(value),'Choose a valid saved reference.'); }
function storage(error:{code?:string}|null,message:string){
  if(!error)return;
  if(['PT409','40001','23505'].includes(error.code??''))throw new Conflict(message);
  if(error.code==='42501')throw new AccessError('Your account no longer has access.',403);
  throw new StorageError(message);
}
export function proposalSummary(proposal:MarketProposal) {
  return {id:proposal.id,contextId:proposal.contextId,hash:proposal.hash,status:proposal.status,orderId:proposal.orderId,
    undoOf:proposal.undoOf,
    beforeTotal:orderTotal(proposal.before),afterTotal:orderTotal(proposal.after),
    before:proposal.before.lines.map(projectLine),after:proposal.after.lines.map(projectLine),stamp:proposal.stamp,
    note:'Unknown prices or quantities remain incomplete. Apply this reviewed batch to save the draft.'};
}

export class MarketOrderAssistant {
  constructor(readonly runtime:OrderRuntime){}
  async order(id:string){
    requireUuid(id);
    const order=await this.runtime.orders.readOrder(id);
    if(!order)throw new AccessError('Order not found.',404);
    const {data:directory}=await this.runtime.share.directory();
    check(directory.clients.some(client=>client.id===order.clientId&&order.marketIds.every(market=>client.marketIds.includes(market))),
      'This order is no longer assigned to this client.');
    check(order.document.lines.every(line=>order.marketIds.includes(line.marketId)),'This order contains a placement outside its assigned markets.');
    return order;
  }
  async launch(orderId:string,view:unknown){
    const order=await this.order(orderId);
    check(order.marketIds.length===1&&order.workflow==='broadcast','Open one broadcast market to use ChatGPT.');
    cleanResearchView(view);
    const state=await stateCommand(this.runtime,orderId,'get');
    check(!state.recovery,'Correct the incomplete fields before opening ChatGPT.');
    const row={order_id:order.id,user_id:this.runtime.user.id,client_id:order.clientId,year:order.year,
      market_id:order.marketIds[0],workflow:order.workflow};
    const {data,error}=await this.runtime.admin.from('ff_order_assistant_contexts').insert(row).select('id').single();
    storage(error,'Could not create this market context.');
    return {contextId:data!.id as string};
  }
  async scoped(contextId:string,write=false){
    requireUuid(contextId);
    const {data,error}=await this.runtime.admin.from('ff_order_assistant_contexts').select('*')
      .eq('id',contextId).eq('user_id',this.runtime.user.id).maybeSingle();
    storage(error,'Could not open this market context.');
    if(!data)throw new AccessError('Market context not found.',404);
    const context:MarketContext={id:data.id,userId:data.user_id,orderId:data.order_id,clientId:data.client_id,year:data.year,
      marketId:data.market_id,workflow:data.workflow,expiresAt:data.expires_at,detached:data.detached};
    const order=await this.order(context.orderId);
    assertMarketContext(context,this.runtime.user.id,order,new Date(),write);
    if(write)check(!order.currentIssue,'Finalized orders are read-only.');
    return {context,order};
  }
  async versions(marketId:string):Promise<SourceVersions>{
    const {data,error}=await this.runtime.admin.rpc('ff_order_assistant_versions',{p_market:marketId});
    storage(error,'Could not verify current research. Try again.');
    return {database:data,build:digest({mapping,assignments,markets:MARKETS,archive:await loadOrderArchiveDigest(),
      version:'market-order-1'})};
  }
  async read(contextId:string){
    const {context,order}=await this.scoped(contextId);
    const [state,sources]=await Promise.all([stateCommand(this.runtime,order.id,'get'),this.versions(context.marketId)]);
    const {data:pending,error}=await this.runtime.admin.from('ff_order_assistant_proposals').select('proposal')
      .eq('order_id',order.id).eq('user_id',this.runtime.user.id).order('created_at',{ascending:false}).limit(20);
    storage(error,'Could not load pending changes.');
    const stamp:RevisionStamp={order:order.revision,research:state.revision,view:state.viewRevision,sources};
    // Do not expose storage paths, PDF artifacts, historical attachments, or other markets to the model.
    return {context,marketName:String(MARKETS[context.marketId]?.name??context.marketId),
      order:{id:order.id,revision:order.revision,document:projectDocument(order.document),total:orderTotal(order.document),finalized:!!order.currentIssue},
      shortlist:state.shortlist,view:state.view??{sheet:'tv' as const},hasIncompleteFields:!!state.recovery,
      proposals:(pending??[]).map(row=>proposalSummary(row.proposal as MarketProposal)),stamp,checkedAt:new Date().toISOString()};
  }
  async research(order:OrderDetail,view:ResearchView,ids?:string[]){
    const {data:directory}=await this.runtime.share.directory();
    const params=new URLSearchParams({workflow:order.workflow});
    for(const [key,value]of Object.entries(view))if(value!==undefined&&value!==null&&key!=='selection'&&key!=='shortlist'&&key!=='target')
      params.set(key,String(value));
    if(view.sheet==='tv'||view.sheet==='radio')params.set('quoteFilters','1');
    const filters:Parameters<typeof loadOrderResearch>[4]={};
    if(ids){params.set('page',String(view.page??1));filters.shortlist={mode:'shortlisted',ids:new Set(ids)};}
    else{
      const state=await stateCommand(this.runtime,order.id,'get');
      if(view.selection&&view.selection!=='all')filters.selection={mode:view.selection,keys:new Set(selectedResearchKeys(order.document.lines))};
      if(view.shortlist&&view.shortlist!=='all')filters.shortlist={mode:view.shortlist,ids:new Set(state.shortlist[view.sheet]??[])};
    }
    const result=await loadOrderResearch(directory,params,this.runtime.supabase,
      {clientId:order.clientId,marketId:order.marketIds[0],year:order.year},filters,this.runtime.researchApiKey);
    check(result.rows.every(row=>row.marketId===order.marketIds[0]),'Research returned an unexpected market.');
    return result;
  }
  async compareMarket(contextId:string) {
    const {context,order}=await this.scoped(contextId);
    const scope={clientId:order.clientId,marketId:context.marketId,year:order.year};
    const before=await this.versions(context.marketId);
    const [{data:directory},archive]=await Promise.all([this.runtime.share.directory(),loadOrderArchive()]);
    const sample=archive ? archiveOrderSeed(archive,directory,{...scope,year:Math.max(scope.year,archive.year+1),
      marketIds:[scope.marketId],workflow:'broadcast',archiveId:''}) : null;
    const research=await Promise.all((['tv','radio'] as const).map(async sheet=>{
      const data=await loadOrderResearch(directory,new URLSearchParams({workflow:'broadcast',sheet,quoteFilters:'1'}),
        this.runtime.supabase,scope,{includeMarketCoverage:true},this.runtime.researchApiKey);
      return {sheet,coverage:'marketCoverage' in data ? data.marketCoverage ?? null : null};
    }));
    const [after,latestOrder]=await Promise.all([this.versions(context.marketId),this.runtime.orders.readOrder(order.id)]);
    if(digest(before)!==digest(after))throw new Conflict('Research changed while comparing the market. Try again.');
    if(latestOrder?.revision!==order.revision)throw new Conflict('The order changed while comparing the market. Try again.');
    const group=(lines:OrderLine[])=>orderVendorGroups(lines,line=>line).map(({vendor,rep,items})=>({
      vendor,rep,placements:items.map(line=>({id:line.id,station:line.station,channel:line.media,
        program:line.program,format:line.format,flight:[line.start,line.end].filter(Boolean).join(' – '),
        priorFlight:line.priorFlight,rate:line.rate,spots:line.quantity,
        amount:orderLineAmount(line),impressions:line.impressions,source:line.source?.label,locator:line.source?.locator})),
    }));
    const broadcastLines=order.document.lines.filter(isBroadcastPlacement);
    return {marketId:context.marketId,marketName:String(MARKETS[context.marketId]?.name??context.marketId),orderYear:order.year,
      scope:'whole_market',sample:archive && sample ? {year:archive.year,groups:group(sample.lines),placementCount:sample.lines.length} : null,
      currentOrder:{revision:order.revision,groups:group(broadcastLines),placementCount:broadcastLines.length},
      research,sources:after,checkedAt:new Date().toISOString()};
  }
  async search(contextId:string,override:unknown={},wholeMarket=false){
    const {context,order}=await this.scoped(contextId);
    const state=await stateCommand(this.runtime,order.id,'get');
    const view=cleanResearchView({...(!wholeMarket && state.view || {sheet:'tv'}),...override as object});
    if(wholeMarket)check(view.sheet==='tv'||view.sheet==='radio','Choose TV or Radio for whole-market broadcast research.');
    const before=await this.versions(context.marketId);
    const result=await this.research(order,view);
    const after=await this.versions(context.marketId);
    if(digest(before)!==digest(after))throw new Conflict('Research changed while loading. Read it again.');
    return {...projectResearchPage(result),view,sources:after,checkedAt:new Date().toISOString(),
      nextPage:result.page<result.pageCount?result.page+1:null};
  }
  async rows(contextId:string,sheet:string,ids:string[]){
    check(ids.length>0&&ids.length<=100&&ids.every(id=>typeof id==='string'&&id.length<=400),'Choose up to 100 exact quote rows.');
    const {order}=await this.scoped(contextId);
    const view=cleanResearchView({sheet});
    check(sheet==='tv'||sheet==='radio','Choose TV or Radio quotes.');
    const before=await this.versions(order.marketIds[0]);
    const result=await this.research(order,view,ids),rows=[...result.rows];
    for(let page=2;page<=result.pageCount;page++){
      check(page<=100,'The exact-row query is too large.');
      rows.push(...(await this.research(order,{...view,page},ids)).rows);
    }
    check(ids.every(id=>rows.some(row=>row.id===id)),'One or more quotes are no longer available in this market.');
    if(digest(before)!==digest(await this.versions(order.marketIds[0])))throw new Conflict('Research changed while reading the quote rows.');
    return rows;
  }
  async bindChat(contextId:string,session:unknown){
    const {context}=await this.scoped(contextId);
    check(typeof session==='string'&&session.length>0&&session.length<=500,
      'This host did not provide a conversation scope. Open this market in a supported ChatGPT host.');
    const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!key)throw new StorageError('Order authentication is unavailable.');
    const hash=createHmac('sha256',key).update('ff-market-chat-v1:'+session).digest('hex');
    const {error}=await this.runtime.admin.rpc('ff_order_assistant_bind_chat',{p_actor:this.runtime.user.id,
      p_context:context.id,p_session:hash});
    storage(error,'This chat is already tied to a different order. Start a new chat for this market.');
  }
  async stars(contextId:string,sheet:string,expectedRevision:number,raw:unknown,operationId:string){
    const {order}=await this.scoped(contextId,true),items=cleanStarUpdates(raw);
    requireUuid(operationId);
    const sources=await this.versions(order.marketIds[0]);
    // Unstarring a retired source remains possible; adding stars requires current attributable rows.
    if(items.some(item=>item.starred))await this.rows(contextId,sheet,items.filter(item=>item.starred).map(item=>item.rowId));
    return stateCommand(this.runtime,order.id,'stars',{sheet,expectedRevision,items,operationId,sources:sources.database});
  }
  async prepare(contextId:string,stamp:RevisionStamp,raw:unknown,operationId:string){
    requireUuid(operationId);
    const current=await this.read(contextId);
    await this.scoped(contextId,true);
    if(digest(stamp)!==digest(current.stamp))throw new Conflict('Order or research changed. Refresh before preparing changes.');
    check(!current.hasIncompleteFields,'Correct incomplete fields before preparing order changes.');
    const changes=cleanOrderChanges(raw),order=await this.order(current.order.id);
    const existing=await this.runtime.admin.from('ff_order_assistant_proposals').select('proposal')
      .eq('user_id',this.runtime.user.id).eq('operation_id',operationId).maybeSingle();
    storage(existing.error,'Could not verify this proposal request.');
    if(existing.data){
      const prior=existing.data.proposal as MarketProposal;
      check(prior.contextId===contextId&&digest(prior.changes)===digest(changes),'This operation ID belongs to another proposal.');
      return prior;
    }
    const rows=changes.add.length?await this.rows(contextId,changes.sheet,[...new Set(changes.add.map(item=>item.rowId))]):[];
    const after=buildOrderChanges(order,changes,rows,randomUUID);
    if(digest(await this.versions(current.context.marketId))!==digest(stamp.sources))throw new Conflict('Research changed. Review again.');
    const proposal:MarketProposal={id:randomUUID(),contextId,orderId:order.id,userId:this.runtime.user.id,stamp,changes,
      before:order.document,after,hash:'',status:'pending',operationId,createdAt:new Date().toISOString()};
    proposal.hash=digest({contextId,stamp,changes,before:proposal.before,after:proposal.after});
    const {error}=await this.runtime.admin.from('ff_order_assistant_proposals').insert({id:proposal.id,context_id:contextId,
      order_id:order.id,user_id:this.runtime.user.id,operation_id:operationId,proposal});
    storage(error,'This proposal could not be saved. Refresh before retrying.');
    return proposal;
  }
  async proposal(contextId:string,proposalId:string){
    const {order}=await this.scoped(contextId);
    return this.proposalForOrder(order.id,proposalId);
  }
  async proposalForOrder(orderId:string,proposalId:string){
    requireUuid(proposalId);
    const order=await this.order(orderId);
    const {data,error}=await this.runtime.admin.from('ff_order_assistant_proposals').select('proposal')
      .eq('id',proposalId).eq('user_id',this.runtime.user.id).eq('order_id',order.id).maybeSingle();
    storage(error,'Could not read this proposal.');
    if(!data)throw new AccessError('Proposal not found.',404);
    return data.proposal as MarketProposal;
  }
  async undo(orderId:string,proposalId:string){
    const original=await this.proposalForOrder(orderId,proposalId),order=await this.order(orderId);
    check(original.status==='applied'&&!original.undoOf,'Choose a completed placement change to undo.');
    check(order.revision===original.resultRevision&&digest(order.document)===digest(original.after),
      'The order changed after this batch. Review a new proposal instead of undoing it.');
    const {contextId}=await this.launch(orderId,{sheet:original.changes.sheet});
    const current=await this.read(contextId);
    check(digest(current.stamp.sources)===digest(original.stamp.sources),'Research changed after this batch. Review the order again.');
    const proposal:MarketProposal={id:randomUUID(),contextId,orderId,userId:this.runtime.user.id,
      stamp:current.stamp,changes:{sheet:original.changes.sheet,add:[],remove:[]},before:order.document,
      after:original.before,hash:'',status:'pending',operationId:randomUUID(),createdAt:new Date().toISOString(),undoOf:original.id};
    proposal.hash=digest({contextId,stamp:proposal.stamp,undoOf:original.id,before:proposal.before,after:proposal.after});
    const {error}=await this.runtime.admin.from('ff_order_assistant_proposals').insert({id:proposal.id,context_id:contextId,
      order_id:orderId,user_id:this.runtime.user.id,operation_id:proposal.operationId,proposal});
    storage(error,'Could not prepare this undo.');
    return proposal;
  }
  async apply(contextId:string,proposalId:string,approvedHash:string){
    const {context,order}=await this.scoped(contextId,true);
    const proposal=await this.proposal(contextId,proposalId);
    check(proposal.contextId===contextId&&proposal.hash===approvedHash,'Approve this exact proposal before applying.');
    const sources=await this.versions(context.marketId);
    if(proposal.status!=='applied'){
      const current=await this.read(contextId);
      if(digest(current.stamp)!==digest(proposal.stamp))throw new Conflict('Order or research changed. Review an updated proposal.');
      check(!current.hasIncompleteFields,'Correct incomplete fields before applying changes.');
      if(proposal.undoOf){
        const original=await this.proposalForOrder(order.id,proposal.undoOf);
        check(original.status==='applied'&&order.revision===original.resultRevision&&
          digest(order.document)===digest(original.after)&&digest(proposal.after)===digest(original.before)&&
          digest(sources)===digest(original.stamp.sources),'The order or research changed after this batch.');
      }else{
        const rows=proposal.changes.add.length?await this.rows(contextId,proposal.changes.sheet,
          [...new Set(proposal.changes.add.map(item=>item.rowId))]):[];
        const added=proposal.after.lines.filter(line=>!proposal.before.lines.some(prior=>prior.id===line.id)).map(line=>line.id);
        const after=buildOrderChanges(order,proposal.changes,rows,()=>added.shift()!);
        check(digest(after)===digest(proposal.after),'The applicable quote or schedule changed. Review an updated proposal.');
      }
    }
    const {data,error}=await this.runtime.admin.rpc('ff_order_assistant_apply',{p_actor:this.runtime.user.id,
      p_proposal:proposalId,p_hash:approvedHash,p_sources:sources.database});
    storage(error,'Order or research changed. Review an updated proposal before applying.');
    return data as OrderDetail;
  }
}
