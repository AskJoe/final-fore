import Decimal from 'decimal.js';
import { TEMPLATE } from './catalogs';
import { MAPPING, PRIMARY, ACTIVE, serialDate } from './workbook';
import { colName, coordinates } from './formulas';
import { check, object, finite, today, day, Conflict, type Workbook, type Data } from './types';
const PARTIES={client:TEMPLATE.client,vendor:TEMPLATE.vendor};
const TEXT:Data={orderNumber:100,orderDate:10,representative:200,contact:200,email:200,terms:500,zipList:5000,notes:5000,productionDescription:500,digitalStart:10,digitalEnd:10,broadcastStart:10,broadcastEnd:10};
const NUMBERS:Data={productionAmount:100000000,digitalWeeks:53,broadcastWeeks:53};
const LINE_TEXT:Data={channel:10,station:200,program:300,length:100,runDays:100,start:10,end:10,notes:1000};
const LINE_NUMBERS:Data={rate:10000000,spots:10000000,audience:1000000000};
export function defaults():Data {return {orderNumber:'',orderDate:today(),representative:'',...PARTIES,contact:TEMPLATE.contact,email:TEMPLATE.email,terms:TEMPLATE.terms,zipList:'',notes:'',productionDescription:'',productionAmount:'',digitalStart:'',digitalEnd:'',broadcastStart:'',broadcastEnd:'',digitalWeeks:'',broadcastWeeks:'',broadcast:[],mediaDetails:{}};}
export function validate(details:any):Data {
  const clean=defaults();check(object(details),'Order details must be an object.');check(Object.keys(details).every(k=>Object.hasOwn(clean,k)),'Unknown order field.');
  for(const [key,expected] of Object.entries(PARTIES))check(!Object.hasOwn(details,key)||details[key]===expected,'This workbook is for client Weed Man and vendor EPIC3. Reload the order to use its current client and vendor.');
  function text(value:any,limit:number) {check(typeof value==='string'&&value.length<=limit,`Text fields must be at most ${limit} characters.`);return value.trim();}
  function numeric(value:any,maximum:number):number|'' {if(value===''||value==null)return '';check((typeof value==='number'||typeof value==='string'&&!!value.trim())&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=maximum,`Enter a number from 0 to ${maximum.toLocaleString('en-US')}.`);return Number(value);}
  function validDate(value:string) {if(value){day(value,'Date');check(Number(value.slice(0,4))>=1900&&Number(value.slice(0,4))<=2099,'Dates must be between 1900 and 2099.');}}
  for(const [key,limit] of Object.entries(TEXT)){if(Object.hasOwn(details,key))clean[key]=text(details[key],limit);if(/(Start|End|Date)$/.test(key))validDate(clean[key]);}
  for(const [key,max] of Object.entries(NUMBERS))clean[key]=numeric(details[key]??'',max);
  const lines=details.broadcast??[];check(Array.isArray(lines)&&lines.length<=100,'Use at most 100 broadcast schedule lines.');
  for(const line of lines){check(object(line)&&Object.keys(line).every(k=>Object.hasOwn(LINE_TEXT,k)||Object.hasOwn(LINE_NUMBERS,k)),'Invalid broadcast line.');const item:Data=Object.fromEntries(Object.entries(LINE_TEXT).map(([k,n])=>[k,text(line[k]??'',n)]));check(['Radio','TV'].includes(item.channel),'Choose Radio or TV for each schedule line.');for(const [key,max] of Object.entries(LINE_NUMBERS))item[key]=numeric(line[key]??'',max);check(item.spots===''||Number.isInteger(item.spots),'Total spots must be a whole number.');validDate(item.start);validDate(item.end);clean.broadcast.push(item);}
  const media=details.mediaDetails??{};check(object(media)&&Object.keys(media).length<=100,'Use at most 100 digital detail entries.');
  const allowed:Data={length:100,runDays:100,start:10,end:10,notes:2000};
  for(const [key,item] of Object.entries(media)){check(key.length<=40&&object(item),'Invalid digital detail entry.');check(Object.keys(item).every(k=>Object.hasOwn(allowed,k)),'Media amounts must be edited in EPIC3.');clean.mediaDetails[key]=Object.fromEntries(Object.entries(allowed).map(([k,n])=>[k,text(item[k]??'',n)]));validDate(clean.mediaDetails[key].start);validDate(clean.mediaDetails[key].end);}
  return clean;
}
const dec=(value:any)=>new Decimal(finite(value)?value:0);
const zero=()=>new Decimal(0);
export function model(w:Workbook,row:number,details:Data):Data {
  check(PRIMARY.includes(row),'Choose a market from the list.');const issues:string[]=[],invalidAmounts:string[]=[];
  const issue=(message:string)=>{if(!issues.includes(message))issues.push(message);};const value=(sheet:string,address:string)=>w.sheets[sheet]?.[address]?.value??null;
  const amount=(sheet:string,address:string):Decimal|null=>{const v=value(sheet,address);if(v===null)return zero();if(finite(v)){if(v<0)issue(`${sheet} ${address} contains a negative amount. Confirm it before using this order.`);return dec(v);}invalidAmounts.push(sheet+'!'+address);issue(`${sheet} ${address} has an unresolved value: ${v}.`);return null;};
  const sourceSchedule:Data={};for(const [k,c] of [['digitalStart','E'],['digitalEnd','F'],['broadcastStart','H'],['broadcastEnd','I']])sourceSchedule[k]=serialDate(value('Variables',c+row));for(const [k,c] of [['digitalWeeks','G'],['broadcastWeeks','J']])sourceSchedule[k]=value('Variables',c+row);
  const schedule:Data=Object.fromEntries(Object.entries(sourceSchedule).map(([k,v])=>[k,details[k]!==''&&details[k]!=null?details[k]:v]));
  const market=String(value('Markets','C'+row)||''),column=MAPPING[row]??null,lines:Data[]=[],fees:Data[]=[];
  function impressions(c:string,r:number) {const [,n]=coordinates(c+'1'),v=value('EPIC3',colName(n+2)+r);return finite(v)&&v>0?v:null;}
  function addLine(key:string,label:string,c:string,r:number,group:string,fee:Decimal|null=zero()) {
    const spend=amount('EPIC3',c+r),imps=impressions(c,r);if(spend?.isZero()&&!imps)return false;
    const base=TEMPLATE.digital[r]??{},override=details.mediaDetails[key]??{};
    lines.push({key,label,group,amount:spend?.toNumber()??null,fee:fee?.toNumber()??null,impressions:imps,source:c+r,description:base.description??'',length:override.length||base.length||'',runDays:override.runDays||base.runDays||'',start:override.start||schedule.digitalStart,end:override.end||schedule.digitalEnd,notes:override.notes??''});return true;
  }
  const broadcast:Record<string,Decimal|null>={Radio:amount('Markets','P'+row),TV:amount('Markets','Q'+row)};
  if(column){
    if(row!==48){
      for(let r=8;r<=20;r++)addLine('r'+r,String(value('EPIC3','A'+r)||''),column,r,'Gross digital');
      const net=amount('EPIC3',column+'28'),netFee=amount('EPIC3',column+'29');let allocated=zero();
      for(let r=22;r<=27;r++){const spend=amount('EPIC3',column+r),fee=spend!==null&&net!==null&&!net.isZero()&&netFee!==null?spend.times(netFee).div(net):zero();allocated=allocated.plus(fee);addLine('r'+r,String(value('EPIC3','A'+r)||''),column,r,'Net digital',fee);}
      if(netFee!==null&&netFee.minus(allocated).abs().gt('0.000001')){fees.push({label:'Net-media fee not allocated to a channel',amount:netFee.minus(allocated).toNumber()});issue('The net-media fee does not reconcile with the individual channels. Review EPIC3 rows 22–29.');}
      const f=amount('EPIC3',column+'31'),a=amount('EPIC3',column+'30'),added=addLine('r30',String(value('EPIC3','A30')||''),column,30,'Net digital',f);
      if(!added&&a?.isZero()&&f&&!f.isZero()){fees.push({label:'7.5% pool fee without media',amount:f.toNumber()});issue('A fee is present without its net-media amount in EPIC3 row 30.');}
    }
    const trade=row!==55?amount('EPIC3',column+'6'):zero();if(trade&&!trade.isZero())fees.push({label:'Radio trade schedule fee',amount:trade.toNumber()});
    if(row===48)fees.push({label:'Shared-buy partner fee',amount:amount('EPIC3','BW36')?.toNumber()??null});
  }else if(row===287){for(const c of ACTIVE){const name=String(value('EPIC3',c+'1')||c).replaceAll('2026','').trim();for(const [r,fr] of [[40,41],[44,45],[48,49]])addLine(c+'_'+r,name+' · '+String(value('EPIC3','A'+r)||''),c,r,'Net digital',amount('EPIC3',c+fr));}}
  else if(row===290)for(const c of ACTIVE)addLine(c+'_3',String(value('EPIC3',c+'1')||c).replaceAll('2026','').trim()+' · Weather reserve',c,3,'Gross digital');
  const activeKeys=new Set(lines.map(l=>l.key));if(Object.keys(details.mediaDetails).some(k=>!activeKeys.has(k)))issue('Saved details exist for channels that currently have no media amount. They are retained for later use.');
  function checkDates(start:string,end:string,label:string){if(!start||!end){issue(label+': enter both flight dates.');return;}if(end<start)issue(label+': the end date is before the start date.');if(!start.startsWith('2026-')||!end.startsWith('2026-'))issue(label+': confirm flight dates outside 2026.');}
  for(const [field,label] of [['orderNumber','order number'],['representative','representative'],['client','client'],['orderDate','order date'],['zipList','ZIP-code list or reference']])if(!details[field])issue('Enter the '+label+'.');
  if(!details.email||!details.email.includes('@'))issue('Enter a contact email address.');if(details.productionAmount&&!details.productionDescription)issue('Describe the production charge.');
  const allocations:Record<string,Decimal>={Radio:zero(),TV:zero()},schedules:Data[]=[];
  for(const [i,original] of details.broadcast.entries()){
    const item={...original},start=item.start||schedule.broadcastStart,end=item.end||schedule.broadcastEnd,index=i+1;
    for(const [key,label] of [['station','station'],['program','program time'],['runDays','run days'],['length','ad length']])if(!item[key])issue(`Broadcast line ${index}: enter ${label}.`);
    if(item.rate===''||item.spots==='')issue(`Broadcast line ${index}: enter the spot rate and total spots for the full flight.`);
    const cost=dec(item.rate).times(dec(item.spots));allocations[item.channel]=allocations[item.channel].plus(cost);
    const imps=item.audience!==''&&item.spots!==''?dec(item.audience).times(dec(item.spots)):null;checkDates(start,end,'Broadcast line '+index);
    schedules.push({...item,amount:cost.toNumber(),impressions:imps?.toNumber()??null,start,end});
  }
  for(const [channel,budget] of Object.entries(broadcast)){
    if(budget===null)continue;const difference=budget.minus(allocations[channel]);
    if(difference.abs().gt('0.005'))issue(`${channel} schedules differ from the EPIC3 budget by $${difference.toNumber().toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}. Enter or review the station details.`);
    if(budget.gt(0)&&!schedules.some(s=>s.channel===channel))checkDates(schedule.broadcastStart,schedule.broadcastEnd,channel);
  }
  for(const line of lines){checkDates(line.start,line.end,line.label);if(!line.impressions&&(line.amount??0)>0)issue(line.label+': impression estimate is unavailable; the preview will show TBD.');if(!line.length)issue(line.label+': enter the creative format or ad length.');if(!line.runDays)issue(line.label+': enter run days.');}
  let mediaTotal=Object.values(broadcast).reduce<Decimal>((s,v)=>s.plus(v??0),zero());for(const l of lines)mediaTotal=mediaTotal.plus(dec(l.amount)).plus(dec(l.fee));for(const f of fees)mediaTotal=mediaTotal.plus(dec(f.amount));
  const expected=amount('Markets','Z'+row),balanced=!invalidAmounts.length&&expected!==null&&mediaTotal.minus(expected).abs().lt('0.005')&&lines.every(l=>l.amount!==null&&l.fee!==null)&&Object.values(broadcast).every(v=>v!==null)&&fees.every(f=>f.amount!==null);
  if(!balanced)issue('Order media amounts do not fully reconcile with Markets. Resolve the source amounts before treating this draft as complete.');
  const knownImps=[...lines,...schedules].reduce((s,l)=>s+(l.impressions??0),0),incomplete=lines.some(l=>(l.amount??0)>0&&!l.impressions)||Object.entries(broadcast).some(([k,v])=>v&&!v.isZero()&&(!schedules.some(s=>s.channel===k)||schedules.some(s=>s.channel===k&&s.impressions===null)));
  const production=dec(details.productionAmount);
  return {market,marketRow:row,sourceColumn:column,sourceSchedule,schedule,lines,broadcast:schedules,broadcastBudgets:Object.fromEntries(Object.entries(broadcast).map(([k,v])=>[k,v?.toNumber()??null])),broadcastAllocated:Object.fromEntries(Object.entries(allocations).map(([k,v])=>[k,v.toNumber()])),fees,mediaTotal:invalidAmounts.length?null:mediaTotal.toNumber(),knownMediaTotal:mediaTotal.toNumber(),productionTotal:production.toNumber(),total:invalidAmounts.length?null:mediaTotal.plus(production).toNumber(),marketsTotal:expected!==null&&!invalidAmounts.length?expected.toNumber():null,recordedMarketsTotal:expected?.toNumber()??null,balanced,knownImpressions:knownImps,incompleteImpressions:incomplete,issues,sharedBuy:row===48?{epic3Broadcast:value('Markets','Z49'),partnerBroadcast:value('Markets','Z50')}:null,nonpaidTrade:value('Markets','O'+row),template:{terms:TEMPLATE.acceptance,rateNote:TEMPLATE.rateNote,stationNote:TEMPLATE.stationNote}};
}
export function snapshot(w:Workbook,row:any,details?:Data):Data {
  check((typeof row==='string'||typeof row==='number')&&Number.isInteger(Number(row)),'Choose a valid market.');row=Number(row);check(PRIMARY.includes(row),'Choose a market from the list.');
  const record=w.orderDrafts[row],draft=details!==undefined?validate(details):record?validate({...record.details,...PARTIES}):defaults();
  return {markets:w.metadata.markets_rows,sourceRevision:w.metadata.revision,draftRevision:record?.revision??0,savedAt:record?.updatedAt??null,details:draft,order:model(w,row,draft)};
}
export function save(w:Workbook,payload:Data) {
  const clean=validate(payload.details),current=snapshot(w,payload.market,clean);
  if(payload.sourceRevision!==current.sourceRevision)throw new Conflict('EPIC3 changed. Refresh source amounts, then save again. Your entered details can be kept.');
  if(payload.draftRevision!==current.draftRevision)throw new Conflict('This draft changed in another window. Reload its saved version before saving.');
  w.orderDrafts[Number(payload.market)]={revision:payload.draftRevision+1,details:clean,updatedAt:new Date().toISOString()};return snapshot(w,payload.market);
}
