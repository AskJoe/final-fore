(function(root){
 'use strict';
 const labels={impressions:'Missing impressions',forms:'Missing form-fill count',clicks:'Click count needs review',mapping:'Unresolved classification',repeated:'Repeated source row',creative:'Missing subcampaign',forms_source:'Form-fill fields differ',errors:'Source formula error'};
 const numeric=v=>{if(v==null||String(v).trim()==='')return null;const n=Number(String(v).replaceAll(',','').trim());return Number.isFinite(n)?n:null;};
 const iso=v=>{const m=String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);if(!m)return '';return `${m[3].length===2?'20'+m[3]:m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;};
 const channel=v=>{const s=v.trim();return ({display:'Display',podcast:'Podcast','video preroll':'Video Preroll','pre-roll':'Video Preroll','amazon_display':'Amazon Display'})[s.toLowerCase()]||s||'Unmapped';};
 const market=v=>v.trim().replace(/\s+/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())||'Unmapped';
 const dimension=v=>!v.trim()||v.trim().startsWith('#')?'Unmapped':v.trim();
 function parse(snapshot){return snapshot.records.map(([row,r,issues])=>({row,raw:r,issues,year:r[0],week:numeric(r[20]),start:iso(r[21]),end:iso(r[22]),creative:r[2].trim()||'(No subcampaign)',impressions:numeric(r[3]),clicks:numeric(r[4]),forms:numeric(r[17]),verification:numeric(r[18]),sessions:numeric(r[19]),channel:dimension(channel(r[23])),market:dimension(market(r[24])),group:dimension(r[25])}));}
 function filter(rows,f){const q=(f.search||'').trim().toLowerCase();return rows.filter(r=>(!f.year||r.year===f.year)&&(!f.group||r.group===f.group)&&(!f.market||r.market===f.market)&&(!f.channel||r.channel===f.channel)&&(!f.start||r.start>=f.start)&&(!f.end||r.start<=f.end)&&(!f.quality||r.issues.includes(f.quality))&&(!q||[r.creative,r.market,r.channel,r.group,String(r.row)].some(v=>v.toLowerCase().includes(q))));}
 function aggregate(rows){const a={count:rows.length,coverage:{},issues:{},matchedForms:0,matchedFormImpressions:0,matchedFormRows:0,matchedClicks:0,matchedClickImpressions:0,matchedClickRows:0};
  for(const k of ['impressions','clicks','forms','sessions','verification']){const values=rows.filter(r=>r[k]!==null);a[k]=values.length?values.reduce((sum,r)=>sum+r[k],0):null;a.coverage[k]=values.length;}
  for(const r of rows){for(const k of r.issues)a.issues[k]=(a.issues[k]||0)+1;if(r.impressions>0&&r.forms!==null){a.matchedForms+=r.forms;a.matchedFormImpressions+=r.impressions;a.matchedFormRows++;}if(r.impressions>0&&r.clicks!==null){a.matchedClicks+=r.clicks;a.matchedClickImpressions+=r.impressions;a.matchedClickRows++;}}
  a.yield=a.matchedFormImpressions?a.matchedForms/a.matchedFormImpressions*1000:null;
  a.ctr=a.issues.clicks?null:a.matchedClickImpressions?a.matchedClicks/a.matchedClickImpressions*100:null;
  return a;
 }
 function group(rows,key){const map=new Map();for(const r of rows){const value=r[key];if(!map.has(value))map.set(value,[]);map.get(value).push(r);}return [...map].map(([name,items])=>({name,...aggregate(items),rows:items}));}
 function csvEscape(v){const s=String(v??'');return '"'+s.replaceAll('"','""')+'"';}
 function csv(rows,headers){return [['Source row',...headers,'Review flags'],...rows.map(r=>[r.row,...r.raw,r.issues.map(k=>labels[k]).join('; ')])].map(r=>r.map(csvEscape).join(',')).join('\r\n');}
 const api={labels,numeric,iso,channel,market,parse,filter,aggregate,group,csv};if(typeof module!=='undefined')module.exports=api;else root.Reporting=api;
})(typeof window==='undefined'?this:window);
