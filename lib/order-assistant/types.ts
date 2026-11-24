import { check, object } from '../domain/types';
import type { OrderDetail, OrderDocument, OrderWorkflow } from '../orders/store';

export const researchSheets = ['tv','radio','demographics','notes','reference','station-history','digital-history','digital'] as const;
export type ResearchView = {
  sheet: typeof researchSheets[number]; q?: string; rep?: string; firm?: string; station?: string;
  primary?: string; secondary?: string; sort?: string; page?: number;
  exactCpm?: number; lowCpm?: number; highCpm?: number;
  selection?: 'all'|'selected'|'unselected'; shortlist?: 'all'|'shortlisted'|'unshortlisted';
  target?: string | null;
};
export type DraftRecovery = { baseRevision: number; document: OrderDocument; fields: Record<string,string> };
export type ResearchState = {
  orderId: string; revision: number; shortlist: Record<string,string[]>;
  viewRevision: number; view: ResearchView | null; recovery: DraftRecovery | null;
};
export type MarketContext = {
  id: string; userId: string; orderId: string; clientId: string; year: number; marketId: string;
  workflow: OrderWorkflow; expiresAt: string; detached: boolean;
};
export type SourceVersions = { database: Record<string,unknown>; build: string };
export type RevisionStamp = { order: number; research: number; view: number; sources: SourceVersions };
export type StarUpdate = {rowId:string;starred:boolean};
export type AddPlacement = {rowId:string;period?:number;quantity?:number|null;spotsPerWeek?:number|null;weeks?:number|null};
export type OrderChanges = {sheet:'tv'|'radio';add:AddPlacement[];remove:string[]};
export type MarketProposal = {
  id:string;contextId:string;orderId:string;userId:string;stamp:RevisionStamp;changes:OrderChanges;
  before:OrderDocument;after:OrderDocument;hash:string;status:'pending'|'applied';operationId:string;
  resultRevision?:number;createdAt:string;
  undoOf?:string;
};

export function cleanResearchView(raw:unknown):ResearchView {
  check(object(raw) && researchSheets.includes(raw.sheet),'Choose a supported research sheet.');
  const allowed=['sheet','q','rep','firm','station','primary','secondary','sort','page','exactCpm','lowCpm','highCpm','selection','shortlist','target'];
  check(Object.keys(raw).every(key=>allowed.includes(key)),'Research view cannot override its market or order.');
  const view:ResearchView={sheet:raw.sheet};
  for (const key of ['q','rep','firm','station','primary','secondary','sort','target'] as const) {
    if (raw[key]===undefined) continue;
    if (key==='target' && raw[key]===null) {view.target=null;continue;}
    check(typeof raw[key]==='string' && raw[key].length<=200,'Research filter is too long.');
    view[key]=raw[key];
  }
  for (const key of ['page','exactCpm','lowCpm','highCpm'] as const) if (raw[key]!==undefined) {
    check(Number.isSafeInteger(raw[key]) && raw[key]>= (key==='page'?1:0) && raw[key]<= (key==='page'?10000:99_999_999_999),'Invalid research filter number.');
    view[key]=raw[key];
  }
  if(raw.selection!==undefined){check(['all','selected','unselected'].includes(raw.selection),'Invalid selection filter.');view.selection=raw.selection;}
  if(raw.shortlist!==undefined){check(['all','shortlisted','unshortlisted'].includes(raw.shortlist),'Invalid shortlist filter.');view.shortlist=raw.shortlist;}
  check(view.lowCpm===undefined || view.highCpm===undefined || view.lowCpm<=view.highCpm,'Low CPM must not exceed high CPM.');
  return view;
}

export function cleanStarUpdates(raw:unknown):StarUpdate[] {
  check(Array.isArray(raw) && raw.length>0 && raw.length<=100,'Choose between 1 and 100 research rows.');
  const items=raw.map(item=>{
    check(object(item) && Object.keys(item).every(key=>key==='rowId'||key==='starred') &&
      typeof item.rowId==='string' && item.rowId.length>0 && item.rowId.length<=400 &&
      typeof item.starred==='boolean','Choose an exact research row and shortlist state.');
    return {rowId:item.rowId,starred:item.starred};
  });
  check(new Set(items.map(item=>item.rowId)).size===items.length,'Choose each research row once.');
  return items;
}

export function assertMarketContext(context:MarketContext,userId:string,
  order:Pick<OrderDetail,'id'|'clientId'|'year'|'marketIds'|'workflow'>,now=new Date(),write=false) {
  check(context.userId===userId,'This market context belongs to another user.');
  check(Number.isFinite(Date.parse(context.expiresAt)) && Date.parse(context.expiresAt)>now.valueOf(),'This chat context expired. Reopen this market from Final Fore.');
  check(context.orderId===order.id && context.clientId===order.clientId && context.year===order.year &&
    context.workflow===order.workflow && order.marketIds.length===1 && context.marketId===order.marketIds[0],
  'This chat is limited to its original market and order.');
  check(!write || !context.detached,'This market is no longer open in the launching view. Reopen it to make changes.');
}
