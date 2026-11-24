import { AccessError } from '../access';
import { check,object,Conflict } from '../domain/types';
import { StorageError } from '../store';
import type { OrderRuntime } from './runtime';
import { cleanResearchView,cleanStarUpdates,type ResearchState } from '../order-assistant/types';

export async function stateCommand(runtime:OrderRuntime,orderId:string,action:string,input:Record<string,unknown>={}) {
  check(/^[0-9a-f-]{36}$/i.test(orderId),'Choose a saved order.');
  const order=await runtime.orders.readOrder(orderId);
  if(!order)throw new AccessError('Order not found.',404);
  const {data:directory}=await runtime.share.directory();
  check(directory.clients.some(client=>client.id===order.clientId&&order.marketIds.every(id=>client.marketIds.includes(id))),
    'This order is no longer assigned to its client.');
  if(action==='stars') {
    check(!order.currentIssue,'Finalized orders are read-only.');
    check(order.marketIds.length===1,'Choose one market before shortlisting research.');
    input={...input,items:cleanStarUpdates(input.items)};
  }
  if(action==='view') {
    input={...input,view:cleanResearchView(input.view)};
    if(input.recovery!==null && input.recovery!==undefined) {
      const recovery=input.recovery;
      check(object(recovery)&&Number.isSafeInteger(recovery.baseRevision)&&recovery.baseRevision>=0&&
        object(recovery.document)&&Array.isArray(recovery.document.lines)&&object(recovery.fields)&&
        Object.keys(recovery.fields).length<=300&&Object.entries(recovery.fields).every(([key,value])=>
          key.length<=250&&typeof value==='string'&&value.length<=5000)&&
        JSON.stringify(recovery).length<=900000,'Invalid draft recovery data.');
    }
  }
  const {data,error}=await runtime.admin.rpc('ff_order_state_command',{p_actor:runtime.user.id,p_order:orderId,p_action:action,p_input:input});
  if(error){
    if(['PT409','40001','23505'].includes(error.code))throw new Conflict('This order or research changed. Reload before retrying.');
    if(error.code==='42501')throw new AccessError('You no longer have access to this order.',403);
    throw new StorageError('Could not save order research. Your changes have not been acknowledged.');
  }
  return data as ResearchState;
}
