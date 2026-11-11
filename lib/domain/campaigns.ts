import Decimal from 'decimal.js';
import { CATALOG, CHANNEL_CATALOG, CHANNELS, MARKETS, VERSION } from './catalogs';
import { check, day, datePair, object, type Data } from './types';
Decimal.set({precision:28,rounding:Decimal.ROUND_HALF_EVEN});
const dec=(v:Decimal.Value)=>new Decimal(v);
const sum=(a:Decimal.Value[])=>a.reduce<Decimal>((s,v)=>s.plus(v),dec(0));
export const rounded=(v:Decimal)=>v.toDecimalPlaces(0,Decimal.ROUND_HALF_UP).toNumber();
export function money(value:any,label:string):number|null { if(value==null)return null; check(Number.isSafeInteger(value)&&value>=0&&value<=100_000_000_000,label+' must be a nonnegative dollar amount with at most two decimal places.');return value; }
export function defaults():Data { return {id:null,revision:0,clientId:'weed-man',name:'Weed Man 2027',year:2027,budget:null,start:'',end:'',regions:{},markets:CATALOG.markets.filter((m:Data)=>m.current).map((m:Data)=>({marketId:m.id,region:m.region,start:'',end:'',override:null}))}; }
export function distribute(total:number,weighted:Record<string,Decimal.Value>) {
  const positive=Object.entries(weighted).filter(([,v])=>dec(v).gt(0)),weight=sum(positive.map(([,v])=>v));
  if(weight.isZero())return {} as Record<string,number>;
  const exact=positive.map(([k,v])=>[k,dec(Math.max(0,total)).times(v).div(weight)] as [string,Decimal]);
  const result:Record<string,number>=Object.fromEntries(exact.map(([k,v])=>[k,v.trunc().toNumber()]));
  const pennies=Math.max(0,total)-Object.values(result).reduce((s,v)=>s+v,0);
  exact.sort(([ka,a],[kb,b])=>b.minus(result[kb]).comparedTo(a.minus(result[ka]))||(ka<kb?-1:ka>kb?1:0));
  for(const [k] of exact.slice(0,pennies))result[k]++;
  return result;
}
export function cleanChannels(raw:any) {
  check(object(raw)&&Object.keys(raw).length<=Object.keys(CHANNELS).length,'Invalid channel allocations.');
  const result:Data={}; for(const [k,v] of Object.entries(raw)){check(Object.hasOwn(CHANNELS,k),'Choose a channel from EPIC3.');result[k]=money(v,'Channel allocation');} return result;
}
export function channelPlan(marketId:string,year:number,budget:number|null,overrides:Data):Data {
  const history=CHANNEL_CATALOG.markets[marketId]??{},years=Object.entries(history).filter(([y])=>Number(y)<year) as [string,Data][];
  const totals:Data=Object.fromEntries(years.map(([y,v])=>[y,Object.values(v.lines).reduce((s:number,l:any)=>s+l.media+l.fee,0)]));
  const rows:Data[]=[];
  for(const [key,channel] of Object.entries(CHANNELS)) {
    const entries:Data[]=[]; let paid=dec(0),imps=dec(0);
    for(const [y,data] of years.sort(([a],[b])=>a.localeCompare(b))) {
      const item=data.lines[key]??{},amount=(item.media??0)+(item.fee??0),share=totals[y]?dec(amount).div(totals[y]):dec(0);
      entries.push({year:Number(y),amount,share:share.toNumber(),sources:item.sources??[],headers:data.headers});
      if(item.media>0&&item.impressions>0){paid=paid.plus(dec(item.impressionMedia??item.media).div(100));imps=imps.plus(item.usableImpressions??item.impressions);}
    }
    const average=entries.length?sum(entries.map(e=>e.share)).div(entries.length):dec(0);
    if(average.lte(0)&&!Object.hasOwn(overrides,key))continue;
    const cpm=channel.cpm&&year>=2026?dec(channel.cpm):imps.gt(0)?paid.div(imps).times(1000):null;
    const rateSource=channel.cpm&&year>=2026?channel.rateSource:cpm&&!cpm.isZero()?'Historical media spend / impressions':null;
    rows.push({...channel,average:entries.length?average.toNumber():null,history:entries,automatic:overrides[key]==null,allocation:overrides[key]??null,cpm:cpm&&!cpm.isZero()?cpm.toNumber():null,rateSource});
  }
  const fixed=rows.filter(r=>!r.automatic).reduce((s,r)=>s+(r.allocation??0),0);
  const shares=budget!==null?distribute(Math.max(0,budget-fixed),Object.fromEntries(rows.filter(r=>r.automatic).map(r=>[r.id,r.average??0]))):{};
  for(const r of rows) {
    if(r.automatic)r.allocation=shares[r.id]??null;
    const a=r.allocation; r.share=a!==null&&budget?a/budget:null;
    r.media=a!==null?rounded(dec(a).div(dec(1).plus(r.feeRate))):null;r.fee=a!==null?a-r.media:null;
    if(r.kind==='fee'){r.media=a!==null?0:null;r.fee=a;}
    r.impressions=['digital','broadcast'].includes(r.kind)&&r.media!==null&&r.cpm?rounded(dec(r.media).div(100).div(r.cpm).times(1000)):null;
  }
  const allocated=rows.reduce((s,r)=>s+(r.allocation??0),0);
  return {rows,allocated,remaining:budget!==null?budget-allocated:null,reserve:rows.filter(r=>r.kind==='reserve').reduce((s,r)=>s+(r.allocation??0),0),version:VERSION,sourceUrl:CHANNEL_CATALOG.sourceUrl};
}
export function clean(raw:any):Data {
  check(object(raw),'Enter campaign details.');check(typeof raw.clientId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(raw.clientId),'Choose a client.');
  const name=raw.name??'',year=raw.year,revision=raw.revision??0,id=raw.id??null;
  check(typeof name==='string'&&name.trim().length>0&&name.length<=120,'Enter a campaign name of 1–120 characters.');
  check(Number.isInteger(year)&&year>=2020&&year<=2100,'Enter a campaign year from 2020 to 2100.');
  check(Number.isSafeInteger(revision)&&revision>=0,'Invalid campaign revision. Reload this campaign.');
  check(id===null||typeof id==='string'&&id.length<=80,'Invalid campaign.');
  check(raw.channelVersion==null||[VERSION,CHANNEL_CATALOG.version].includes(raw.channelVersion),'This campaign uses a different history version. Reload its source before editing.');
  const result:Data={channelVersion:VERSION,id,revision,clientId:raw.clientId,name:name.trim(),year,budget:money(raw.budget,'Campaign budget'),start:day(raw.start,'Campaign start'),end:day(raw.end,'Campaign end'),regions:{},markets:[]};
  for(const key of ['clientName','brand'])if(raw[key]!==undefined){check(typeof raw[key]==='string'&&raw[key].length<=200,'Invalid client details.');result[key]=raw[key];}
  datePair(result.start,result.end,'Campaign');
  for(const key of ['start','end'])check(!result[key]||Number(result[key].slice(0,4))===year,'Campaign dates must fall within the campaign year.');
  const regions=raw.regions??{};check(object(regions),'Invalid regional dates.');
  for(const region of CATALOG.regions){const r=regions[region]??{};check(object(r),'Invalid regional dates.');const start=day(r.start,region+' start'),end=day(r.end,region+' end');datePair(start||result.start,end||result.end,region);result.regions[region]={start,end};}
  check(Array.isArray(raw.markets)&&raw.markets.length<=200,'Choose up to 200 markets.');const seen=new Set();
  for(const r of raw.markets) {
    check(object(r),'Invalid market row.');const mid=r.marketId,custom=r.name??'';
    check(typeof mid==='string'&&!seen.has(mid),'Each market can appear only once.');
    if(!Object.hasOwn(MARKETS,mid))check(mid.startsWith('custom-')&&mid.length<=80&&typeof custom==='string'&&!!custom.trim()&&custom.length<=100,'Choose a market or enter a new market name.');
    seen.add(mid);const region=r.region??'';check(['',...CATALOG.regions].includes(region),'Choose South, Mid, or North.');
    const item:Data={marketId:mid,region,start:day(r.start,'Market start'),end:day(r.end,'Market end'),override:money(r.override,'Market allocation'),channels:cleanChannels(r.channels??{})};
    if(!Object.hasOwn(MARKETS,mid))item.name=custom.trim();
    const name=MARKETS[mid]?.name??custom,regional=result.regions[region]??{},start=item.start||regional.start||result.start,end=item.end||regional.end||result.end;
    datePair(start,end,name);
    for(const value of [start,end]) {check(!value||Number(value.slice(0,4))===year,name+': dates must fall within the campaign year.');check(!value||!result.start||value>=result.start,name+': dates begin before the campaign starts.');check(!value||!result.end||value<=result.end,name+': dates extend beyond the campaign end.');}
    result.markets.push(item);
  }
  return result;
}
export function calculate(raw:any):Data {
  const d=clean(raw),years=CATALOG.years.filter((y:number)=>y<d.year),totals:Data={};
  for(const y of years)totals[y]=d.markets.reduce((s:number,r:Data)=>s+(MARKETS[r.marketId]?.history?.[y]??0),0);
  const rows:Data[]=d.markets.map((r:Data)=>{
    const market=MARKETS[r.marketId]??{},history:Data[]=[],shares:Decimal[]=[];
    for(const y of years){const amount=market.history?.[y]??null,share=amount!==null&&totals[y]>0?dec(amount).div(totals[y]):null;history.push({year:y,budget:amount,share:share?.toNumber()??null});if(share!==null)shares.push(share);}
    const average=shares.length?sum(shares).div(shares.length):null,region=d.regions[r.region]??{};
    return {...r,name:market.name??r.name??'',buyingGroup:market.buyingGroup??'',start:r.start||region.start||d.start,end:r.end||region.end||d.end,startOverride:!!r.start,endOverride:!!r.end,history,average:average?.toNumber()??null,weight:average??dec(0),budget2027:market.budget2027??null,referenceStart:market.referenceStart??'',referenceEnd:market.referenceEnd??'',budgetSourceRow:market.budgetSourceRow??null,datesSourceRow:market.datesSourceRow??null,allocation:r.override,automatic:r.override===null};
  });
  const fixed=rows.filter(r=>r.override!==null).reduce((s,r)=>s+r.override,0),automatic=rows.filter(r=>r.automatic&&r.weight.gt(0));
  const shares=d.budget!==null?distribute(Math.max(0,d.budget-fixed),Object.fromEntries(automatic.map(r=>[r.marketId,r.weight]))):{};
  for(const r of automatic)if(Object.hasOwn(shares,r.marketId))r.allocation=shares[r.marketId];
  const allocated=rows.reduce((s,r)=>s+(r.allocation??0),0);
  for(const r of rows){delete r.weight;r.channelPlan=channelPlan(r.marketId,d.year,r.allocation,r.channels);r.share=r.allocation!==null&&d.budget?r.allocation/d.budget:null;}
  return {details:d,rows,years,allocated,remaining:d.budget!==null?d.budget-allocated:null,needsAllocation:rows.filter(r=>r.allocation===null&&(r.average===null||r.average===0)).length,needsDates:rows.filter(r=>!r.start||!r.end).length};
}
export function catalog():Data {return {catalog:{...CATALOG,channels:CHANNEL_CATALOG.channels},draft:calculate(defaults())};}
