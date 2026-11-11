import Decimal from 'decimal.js';
import { TEMPLATE, OPTIONS, CHANNELS } from './catalogs';
import { calculate, money, rounded } from './campaigns';
import { check, object, today, day, datePair, Conflict, type Data } from './types';
const TEXT:Data={orderNumber:100,orderDate:10,contact:200,email:200,terms:500,zipList:5000,productionDescription:500,signature:200,signedDate:10,zipInitials:30,start:10,end:10};
const LINE_TEXT:Data={station:200,program:300,runDays:100,start:10,end:10,comments:2000};
const MEDIA_TEXT:Data={description:2000,length:150,runDays:100,start:10,end:10};
export function defaults():Data {return {orderNumber:'',orderDate:today(),contact:TEMPLATE.contact,email:TEMPLATE.email,terms:TEMPLATE.terms,zipList:'',productionDescription:'Video production',productionCost:null,productionValue:null,signature:'',signedDate:'',zipInitials:'',start:'',end:'',broadcast:[],mediaDetails:{}};}
function text(value:any,label:string,limit:number) {check(typeof value==='string'&&value.length<=limit,`${label}: use at most ${limit} characters.`);return value.trim();}
function numeric(value:any,label:string,maximum=1_000_000_000) {if(value==null||value==='')return null;check((typeof value==='string'&&!!value.trim()||typeof value==='number')&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=maximum,label+': enter a nonnegative number.');return Number(value);}
function dates(item:Data,label:string) {for(const k of ['start','end'])item[k]=day(item[k],label+' '+k);check(!!item.start===!!item.end,label+': choose both dates or use campaign dates.');datePair(item.start,item.end,label);}
function vendor(raw:any):Data {
  check(object(raw)&&Object.keys(raw).every(k=>['firmId','repId','firmName','repName','email'].includes(k)),'Invalid vendor selection.');
  return Object.fromEntries(['firmId','repId','firmName','repName','email'].map(k=>[k,text(raw[k]??'',k,k==='email'?254:200)]));
}
export function clean(raw:any):Data {
  const result=defaults();check(object(raw)&&Object.keys(raw).every(k=>Object.hasOwn(result,k)),'Invalid order field.');
  for(const [key,limit] of Object.entries(TEXT))result[key]=text(raw[key]??result[key],key,limit);
  for(const key of ['orderDate','signedDate'])result[key]=day(result[key],key);dates(result,'Order');
  for(const key of ['productionCost','productionValue'])result[key]=money(raw[key],key);
  const lines=raw.broadcast??[];check(Array.isArray(lines)&&lines.length<=100,'Use up to 100 broadcast lines.');const ids=new Set();
  for(const line of lines) {
    const allowed=['id','channel',...Object.keys(LINE_TEXT),'rate','spotsDay','spotsWeek','audience','vendor'];
    check(object(line)&&Object.keys(line).every(k=>allowed.includes(k)),'Invalid broadcast field.');
    const item:Data=Object.fromEntries(Object.entries(LINE_TEXT).map(([k,n])=>[k,text(line[k]??'',k,n)]));
    item.id=text(line.id??'','Line ID',80);check(!!item.id&&!ids.has(item.id),'Broadcast line IDs must be unique.');ids.add(item.id);item.channel=line.channel;check(['r4','r5'].includes(item.channel),'Choose TV or radio.');
    item.rate=money(line.rate,'Rate');for(const k of ['spotsDay','spotsWeek','audience'])item[k]=numeric(line[k],k);
    for(const k of ['spotsDay','spotsWeek'])check(item[k]===null||Number.isInteger(item[k]),'Spots must be whole numbers.');dates(item,'Station');if(line.vendor)item.vendor=vendor(line.vendor);result.broadcast.push(item);
  }
  const media=raw.mediaDetails??{};check(object(media)&&Object.keys(media).length<=100,'Invalid digital details.');
  for(const [key,value] of Object.entries(media)) {check(Object.hasOwn(CHANNELS,key)&&object(value)&&Object.keys(value).every(k=>Object.hasOwn(MEDIA_TEXT,k)||k==='vendor'),'Invalid digital field.');const item:Data=Object.fromEntries(Object.entries(MEDIA_TEXT).map(([k,n])=>[k,text(value[k]??'',k,n)]));dates(item,'Channel');if(value.vendor)item.vendor=vendor(value.vendor);result.mediaDetails[key]=item;}
  return result;
}
export function source(campaign:Data,marketId:string):Data {
  const calculated=calculate(campaign),d=calculated.details,market=calculated.rows.find((r:Data)=>r.marketId===marketId);check(market,'This market is not in the campaign.');const plan=market.channelPlan;
  check(market.allocation!==null,'Enter a market allocation and save the campaign first.');check(plan.remaining===0,'Allocate this market’s full budget across channels before creating or refreshing its order.');
  return {campaignId:d.id,campaignName:d.name,campaignRevision:d.revision,...(d.clientName?{clientId:d.clientId,clientName:d.clientName,brand:d.brand}:{}),year:d.year,marketId,marketName:market.name,budget:market.allocation,reserve:plan.reserve,start:market.start,end:market.end,channelVersion:plan.version,lines:plan.rows.filter((r:Data)=>r.kind!=='reserve'&&(r.allocation??0)>0).map(({history,...r}:Data)=>r)};
}
export function flight(item:Data,parent:Data):Data {const start=item.start||parent.start||'',end=item.end||parent.end||'';datePair(start,end,'Flight');const weeks=start&&end?new Decimal((Date.parse(end)-Date.parse(start))/86400000+1).div(7).toNumber():null;return {start,end,weeks};}
export function model(src:Data,details:Data,revision:number):Data {
  const d=clean(details),base=flight(d,src),broadcast:Data[]=[],issues:string[]=[];
  for(const item of [base,...d.broadcast,...Object.values(d.mediaDetails)] as Data[])for(const k of ['start','end'])check(!item[k]||Number(item[k].slice(0,4))===src.year,'Flight dates must fall within the campaign year.');
  if(!base.start||!base.end)issues.push('Set campaign flight dates or override dates.');
  for(const item of d.broadcast) {
    const f=flight(item,base),weeks=f.weeks!==null?new Decimal(f.weeks):null,spots=item.spotsWeek!==null&&weeks!==null?new Decimal(item.spotsWeek).times(weeks):null;
    const cost=item.rate!==null&&spots!==null?rounded(new Decimal(item.rate).times(spots)):null,impressions=item.audience!==null&&spots!==null?rounded(new Decimal(item.audience).times(1000).times(spots)):null;
    const cpm=item.rate!==null&&item.audience?item.rate/100/item.audience:null;
    broadcast.push({...item,...f,spots:spots?.toNumber()??null,total:cost,impressions,cpm});if(cost===null||!item.station||!item.program)issues.push('Complete each station’s program, rate, weekly spots, and flight dates.');
  }
  const lines:Data[]=src.lines.map((item:Data)=>{const override=d.mediaDetails[item.id]??{},template=TEMPLATE.digital[item.row]??{};return {...item,...flight(override,base),...(override.vendor?{vendor:override.vendor}:{}),description:override.description||template.description||item.name,length:override.length||template.length||'',runDays:override.runDays||template.runDays||'M-Su'};});
  const actual:Data={},expected:Data={},difference:Data={};
  for(const key of ['r4','r5']) {actual[key]=broadcast.filter(l=>l.channel===key).reduce((s,l)=>s+(l.total??0),0);expected[key]=lines.filter(l=>l.id===key).reduce((s,l)=>s+(l.allocation??0),0);difference[key]=expected[key]-actual[key];if(difference[key])issues.push(`${key==='r4'?'TV':'Radio'} schedules differ from the campaign allocation.`);}
  const active=new Set(lines.map(l=>l.id)),orphaned=Object.keys(d.mediaDetails).filter(k=>!active.has(k)&&Object.values(d.mediaDetails[k]).some(Boolean));
  if(orphaned.length)issues.push('Some saved channel details are no longer in this campaign allocation; they are retained in the draft.');
  const nonbroadcast=lines.filter(l=>l.kind!=='broadcast'),total=nonbroadcast.reduce((s,l)=>s+(l.allocation??0),0)+Object.values(actual).reduce((s:number,v)=>s+v,0),impressions=[...nonbroadcast,...broadcast].reduce((s,l)=>s+(l.impressions??0),0);
  const incomplete=lines.some(l=>l.kind==='digital'&&l.impressions===null)||broadcast.some(l=>l.impressions===null)||Object.values(difference).some(Boolean);
  if(!d.orderNumber)issues.push('Enter an order number.');if(!d.zipList)issues.push('Add the ZIP-code list or reference.');
  return {campaignId:src.campaignId,marketId:src.marketId,revision,sourceRevision:src.campaignRevision,source:src,details:d,flight:base,lines,broadcast,broadcastExpected:expected,broadcastActual:actual,broadcastDifference:difference,total,impressions,partialImpressions:incomplete,fees:nonbroadcast.reduce((s,l)=>s+(l.fee??0),0),issues:[...new Set(issues)],orphanedDetails:orphaned,psychographs:OPTIONS.psychographs,template:Object.fromEntries(['rateNote','stationNote','acceptance','zipAcceptance'].map(k=>[k,TEMPLATE[k]]))};
}
export function preview(payload:Data,saved:Data|null,campaign:Data):Data {
  check(object(payload),'Enter valid order details.');
  for(const key of ['campaignId','marketId'])check(typeof payload[key]==='string'&&payload[key].length<=80,'Choose a campaign and market.');
  for(const key of ['revision','sourceRevision'])check(Number.isSafeInteger(payload[key])&&payload[key]>=0,'Invalid revision. Reopen this order.');
  const revision=saved?.revision??0;if(payload.revision!==revision)throw new Conflict('This order changed in another window. Reopen it before saving.');
  const refresh=payload.refresh??false;check(typeof refresh==='boolean','Invalid refresh request.');const src=refresh||!saved?source(campaign,payload.marketId):saved.source;
  if(!refresh&&payload.sourceRevision!==src.campaignRevision)throw new Conflict('Campaign values changed. Refresh from campaign before saving this new order.');
  return model(src,payload.details,revision);
}
