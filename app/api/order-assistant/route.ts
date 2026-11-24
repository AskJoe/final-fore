import { check,object } from '@/lib/domain/types';
import { AccessError } from '@/lib/access';
import { failure,json,sameOrigin } from '@/lib/http';
import { orderRuntime } from '@/lib/orders/runtime';
import { stateCommand } from '@/lib/orders/research-state';
import { MarketOrderAssistant,proposalSummary,requireUuid } from '@/lib/order-assistant/service';
import { cleanStarUpdates } from '@/lib/order-assistant/types';
import { chatgptLaunchUrl } from '@/lib/order-assistant/launch';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    if(!sameOrigin(request))throw new AccessError('Use Final Fore to review these changes.',403);
    check(request.headers.get('content-type')?.split(';')[0]==='application/json','Expected JSON.');
    const reader=request.body?.getReader();check(reader,'Expected request body.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>1_000_000){await reader.cancel();return json({error:'This draft is too large.'},413);}chunks.push(value);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    check(object(input),'Expected an object.');
    const ctx=await orderRuntime(),assistant=new MarketOrderAssistant(ctx);
    if(input.action==='state')return json(await stateCommand(ctx,input.orderId,'get'));
    if(input.action==='view')return json(await stateCommand(ctx,input.orderId,'view',input));
    if(input.action==='stars'){
      const order=await assistant.order(input.orderId),items=cleanStarUpdates(input.items);
      const sources=await assistant.versions(order.marketIds[0]);
      check(input.sheet==='tv'||input.sheet==='radio','Choose TV or Radio quotes.');
      const ids=items.filter(item=>item.starred).map(item=>item.rowId);
      if(ids.length){
        const result=await assistant.research(order,{sheet:input.sheet},ids);
        check(ids.every(id=>result.rows.some(row=>row.id===id)),'A quote is no longer in this market.');
      }
      return json(await stateCommand(ctx,order.id,'stars',{...input,items,sources:sources.database}));
    }
    if(input.action==='launch'){
      // Fail before creating a context if the published connection has not been configured.
      chatgptLaunchUrl(process.env.FINAL_FORE_CHATGPT_PLUGIN_ID,'00000000-0000-4000-8000-000000000000');
      const result=await assistant.launch(input.orderId,input.view);
      return json({...result,url:chatgptLaunchUrl(process.env.FINAL_FORE_CHATGPT_PLUGIN_ID,result.contextId)});
    }
    if(input.action==='proposals'){
      const order=await assistant.order(input.orderId);
      const {data,error}=await ctx.admin.from('ff_order_assistant_proposals').select('proposal')
        .eq('order_id',order.id).eq('user_id',ctx.user.id).order('created_at',{ascending:false}).limit(20);
      if(error)throw new Error('Unable to read proposals.');
      return json((data??[]).map(row=>proposalSummary(row.proposal)));
    }
    if(input.action==='read')return json(await assistant.read(input.contextId));
    if(input.action==='apply'){
      check(typeof input.hash==='string','Approve the exact proposed changes.');
      return json(await assistant.apply(input.contextId,input.proposalId,input.hash));
    }
    if(input.action==='refresh'){
      const previous=await assistant.proposalForOrder(input.orderId,input.proposalId);
      const {contextId}=await assistant.launch(previous.orderId,{sheet:previous.changes.sheet});
      const {stamp}=await assistant.read(contextId);
      return json(proposalSummary(await assistant.prepare(contextId,stamp,previous.changes,crypto.randomUUID())));
    }
    if(input.action==='undo')return json(proposalSummary(await assistant.undo(input.orderId,input.proposalId)));
    if(input.action==='detach'){
      requireUuid(input.contextId);
      const {error}=await ctx.admin.from('ff_order_assistant_contexts').update({detached:true})
        .eq('id',input.contextId).eq('user_id',ctx.user.id);
      if(error)throw new Error('Unable to detach this context.');
      return json({detached:true});
    }
    check(false,'Unknown market assistant action.');
  }catch(error){return failure(error);}
}
