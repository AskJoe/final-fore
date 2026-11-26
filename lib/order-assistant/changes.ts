import { check,object } from '../domain/types';
import type { ResearchRow } from '../orders/sources';
import { cleanOrderDocument,type OrderDetail,type OrderDocument,type OrderLine } from '../orders/store';
import { spreadsheetScheduleChanges } from '../orders/metrics';
import { canonicalDigest } from './digest';
import { sectionForSheet, type OrderChanges, type OrderSection } from './types';

export function assertOrderSectionUnchanged(before: OrderDocument, after: OrderDocument, editing: OrderSection) {
  const protect = ({lines,...header}: OrderDocument) => ({
    header, lines: lines.filter(line => (line.media === 'Digital') !== (editing === 'digital')),
  });
  check(canonicalDigest(protect(before)) === canonicalDigest(protect(after)),
    'Only placements on the side of the order opened in this chat may change.');
}

export function cleanOrderChanges(raw:unknown):OrderChanges {
  check(object(raw)&&Object.keys(raw).every(key=>['sheet','add','remove'].includes(key))&&
    (raw.sheet==='tv'||raw.sheet==='radio'||raw.sheet==='digital')&&Array.isArray(raw.add)&&Array.isArray(raw.remove)&&
    raw.add.length+raw.remove.length>0&&raw.add.length+raw.remove.length<=100,'Choose up to 100 exact placement changes.');
  for(const item of raw.add){
    check(object(item)&&Object.keys(item).every(key=>['rowId','period','quantity','spotsPerWeek','weeks'].includes(key))&&
      typeof item.rowId==='string'&&item.rowId.length>0&&item.rowId.length<=400,'Choose an exact quote row.');
    if(raw.sheet==='digital')check(Object.keys(item).length===1,'Choose a Digital reference row without a broadcast schedule.');
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
  check(order.marketIds.length===1&&!order.currentIssue&&order.workflow==='broadcast','Choose one editable market order.');
  const marketId=order.marketIds[0],document=structuredClone(order.document);
  const media = {tv:'TV', radio:'Radio', digital:'Digital'}[changes.sheet];
  for(const id of changes.remove)check(document.lines.some(line=>line.id===id&&line.marketId===marketId&&line.media===media),'Choose a line in this market and media section.');
  document.lines=document.lines.filter(line=>!changes.remove.includes(line.id));
  for(const addition of changes.add){
    const row=rows.find(row=>row.id===addition.rowId);
    check(row&&row.marketId===marketId,'This research row is not in the selected market.');
    let quote:OrderLine|null;
    if(row.periods?.length){
      const index=addition.period??(row.periods.length===1?0:-1);
      quote=row.periods[index]?.line;
    }else quote=row.line;
    check(quote&&quote.marketId===marketId&&quote.media===media,'Choose a research row in this market and media section.');
    if(changes.sheet==='digital'){
      check(quote.source?.kind==='digital'||quote.source?.kind==='historical','Choose a sourced Digital placement.');
      const line:OrderLine={...structuredClone(quote),id:makeId(),start:'',end:'',rate:null,quantity:null,
        amount:null,feeBasisPoints:null,impressions:null,noCharge:false,calculatedCpm:null};
      check(!document.lines.some(existing=>identity(existing)===identity(line)),'This Digital placement is already on the order.');
      document.lines.push(line);
      continue;
    }
    check(quote.source?.kind==='broadcast','Choose a verified current quote and exact period.');
    const quotedSchedule = quote.media === 'Radio' && quote.start && quote.end &&
      quote.quantity != null && quote.spotsPerWeek != null && quote.weeks != null;
    const weeklyEdit = addition.spotsPerWeek !== undefined || addition.weeks !== undefined;
    const scheduleEdit = weeklyEdit || addition.quantity !== undefined;
    const keepQuote = quotedSchedule && !scheduleEdit;
    const line = { ...structuredClone(quote), id: makeId(),
      quantity: addition.quantity !== undefined ? addition.quantity : keepQuote ? quote.quantity : null,
      weeks: addition.weeks !== undefined ? addition.weeks : quotedSchedule ? quote.weeks : null,
      spotsPerWeek: addition.spotsPerWeek !== undefined ? addition.spotsPerWeek
        : quotedSchedule && (weeklyEdit || !scheduleEdit) ? quote.spotsPerWeek : null,
      amount: keepQuote ? quote.amount : null, spotsPerDay: null, impressions: keepQuote ? quote.impressions : null };
    const periodUnit=line.source?.facts?.find(fact=>fact.label==='Quote rate unit');
    const unit=periodUnit ? periodUnit.value : line.source?.facts?.find(fact=>fact.label==='Spot rate')?.unit;
    if(typeof unit!=='string'||!/^USD(?:\s*(?:\/|per)\s*spot)?$/i.test(unit))line.rate=null;
    // Unknown effective dates never become an assumed purchase price.
    if(!line.start||!line.end)line.rate=null;
    else {
      check((!document.end || line.start <= document.end) && (!document.start || line.end >= document.start),
        'This quote is outside the order flight.');
      const start = document.start && line.start < document.start ? document.start : line.start;
      const end = document.end && line.end > document.end ? document.end : line.end;
      check(!keepQuote || start === line.start && end === line.end,
        'Choose a spot schedule for the part of the quote within the order flight.');
      line.start = start;
      line.end = end;
    }
    if(line.rate===null)line.amount=null;
    if(weeklyEdit){
      const schedule=spreadsheetScheduleChanges(line,{spotsPerWeek:line.spotsPerWeek,weeks:line.weeks});
      Object.assign(line,schedule);
      if(addition.quantity!==undefined){
        check(line.quantity===null||addition.quantity===line.quantity,'Quantity conflicts with the weekly schedule.');
        line.quantity=addition.quantity;
      }
    }
    if (!keepQuote) line.impressions = line.audience != null && line.quantity != null ? line.audience * line.quantity : null;
    check(!document.lines.some(existing=>identity(existing)===identity(line)),'This placement and period are already on the order.');
    document.lines.push(line);
  }
  const cleaned = cleanOrderDocument(document,{marketIds:[marketId],workflow:order.workflow});
  const added = new Map(cleaned.lines.map(line => [line.id,line]));
  const untouched = new Map(order.document.lines.map(line => [line.id,line]));
  const after = {...order.document,lines:document.lines.map(line => untouched.get(line.id) ?? added.get(line.id)!)};
  assertOrderSectionUnchanged(order.document,after,sectionForSheet(changes.sheet));
  return after;
}
