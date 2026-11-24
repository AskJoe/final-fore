import { check,object } from '../domain/types';
import type { ResearchRow } from '../orders/sources';
import { cleanOrderDocument,type OrderDetail,type OrderLine } from '../orders/store';
import { spreadsheetScheduleChanges } from '../orders/metrics';
import type { OrderChanges } from './types';

export function cleanOrderChanges(raw:unknown):OrderChanges {
  check(object(raw)&&Object.keys(raw).every(key=>['sheet','add','remove'].includes(key))&&
    (raw.sheet==='tv'||raw.sheet==='radio')&&Array.isArray(raw.add)&&Array.isArray(raw.remove)&&
    raw.add.length+raw.remove.length>0&&raw.add.length+raw.remove.length<=100,'Choose up to 100 exact placement changes.');
  for(const item of raw.add){
    check(object(item)&&Object.keys(item).every(key=>['rowId','period','quantity','spotsPerWeek','weeks'].includes(key))&&
      typeof item.rowId==='string'&&item.rowId.length>0&&item.rowId.length<=400,'Choose an exact quote row.');
    if(item.period!==undefined)check(Number.isSafeInteger(item.period)&&item.period>=0&&item.period<100,'Choose the exact quote period.');
    for(const key of ['quantity','spotsPerWeek','weeks'])if(item[key]!==undefined&&item[key]!==null)
      check(Number.isSafeInteger(item[key])&&item[key]>=0&&item[key]<=1_000_000,'Use a whole nonnegative schedule quantity.');
  }
  check(raw.remove.every((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=100)&&
    new Set(raw.remove).size===raw.remove.length,'Identify each order line once.');
  return raw as OrderChanges;
}

function identity(line:OrderLine){
  return JSON.stringify([line.marketId,line.media,line.source?.kind,line.source?.id,line.source?.researchRowId,
    line.station,line.program,line.format,line.start,line.end]);
}
export function buildOrderChanges(order:OrderDetail,raw:unknown,rows:ResearchRow[],makeId:()=>string) {
  const changes=cleanOrderChanges(raw);
  check(order.marketIds.length===1&&!order.currentIssue&&order.workflow==='broadcast','Choose one editable broadcast market.');
  const marketId=order.marketIds[0],document=structuredClone(order.document);
  for(const id of changes.remove)check(document.lines.some(line=>line.id===id&&line.marketId===marketId),'This order line is no longer in this market.');
  document.lines=document.lines.filter(line=>!changes.remove.includes(line.id));
  for(const addition of changes.add){
    const row=rows.find(row=>row.id===addition.rowId);
    check(row&&row.marketId===marketId,'This research row is not in the selected market.');
    let quote:OrderLine|null;
    if(row.periods?.length){
      const index=addition.period??(row.periods.length===1?0:-1);
      quote=row.periods[index]?.line;
    }else quote=row.line;
    check(quote&&quote.marketId===marketId&&quote.media===(changes.sheet==='tv'?'TV':'Radio')&&
      quote.source?.kind==='broadcast','Choose a verified current quote and exact period.');
    const line={...structuredClone(quote),id:makeId(),quantity:addition.quantity??null,amount:null,
      weeks:addition.weeks??null,spotsPerWeek:addition.spotsPerWeek??null,spotsPerDay:null,impressions:null};
    const periodUnit=line.source?.facts?.find(fact=>fact.label==='Quote rate unit');
    const unit=periodUnit ? periodUnit.value : line.source?.facts?.find(fact=>fact.label==='Spot rate')?.unit;
    if(typeof unit!=='string'||!/^USD(?:\s*(?:\/|per)\s*spot)?$/i.test(unit))line.rate=null;
    if(document.start&&document.end&&line.start&&line.end)
      check(line.start<=document.end&&line.end>=document.start,'This quote is outside the order flight.');
    // Unknown effective dates never become an assumed purchase price.
    if(!line.start||!line.end||!document.start||!document.end)line.rate=null;
    else {
      line.start=line.start<document.start?document.start:line.start;
      line.end=line.end>document.end?document.end:line.end;
    }
    if(addition.spotsPerWeek!==undefined||addition.weeks!==undefined){
      const schedule=spreadsheetScheduleChanges(line,{spotsPerWeek:line.spotsPerWeek,weeks:line.weeks});
      Object.assign(line,schedule);
      if(addition.quantity!==undefined){
        check(line.quantity===null||addition.quantity===line.quantity,'Quantity conflicts with the weekly schedule.');
        line.quantity=addition.quantity;
      }
    }
    check(!document.lines.some(existing=>identity(existing)===identity(line)),'This placement and period are already on the order.');
    document.lines.push(line);
  }
  return cleanOrderDocument(document,{marketIds:[marketId],workflow:order.workflow});
}
