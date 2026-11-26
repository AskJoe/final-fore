'use strict';
const $=id=>document.getElementById(id);
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const money=n=>n==null?'':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const num=n=>n==null?'':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const shortDate=d=>d?`${+d.slice(5,7)}/${+d.slice(8,10)}/${d.slice(2,4)}`:'';
const dateRange=f=>f.start&&f.end?`${shortDate(f.start)}–${shortDate(f.end)}`:'Dates needed';
function labeled(label,value){const n=el('div','','meta-field');n.append(el('span',label,'field-label'),value);return n;}
function table(headers,cls=''){const t=el('table','',cls),h=el('thead'),r=el('tr');for(const v of headers)r.append(el('th',v));h.append(r);t.append(h);const b=el('tbody');t.append(b);return [t,b];}
function cell(row,value,cls=''){const td=el('td','',cls);if(value instanceof Node)td.append(value);else td.textContent=value;row.append(td);return td;}
function vendorLabel(v){return v?[v.firmName,v.repName,v.email].filter(Boolean).join(' · '):'Vendor not selected';}
function paperTable(headers,rows){const [t,b]=table(headers);for(const values of rows){const tr=el('tr');values.forEach((v,i)=>cell(tr,v,i>0?'number':''));b.append(tr);}return t;}
function renderPaper(view){
 const {details}=view;
 const p=$('paper');p.replaceChildren();const head=el('div','','paper-header');head.append(el('h2','Final Fore Media'),el('h2','Media order'));p.append(head);
 const meta=el('div','','paper-meta');for(const [key,value] of [['Order number',details.orderNumber],['Order date',shortDate(details.orderDate)],['Client',view.source.clientName||'Topco'],['Franchise brand',view.source.brand??'Weed Man'],['Franchise market',view.source.marketName],['Contact',details.contact],['Email',details.email],['Terms',details.terms],['Flight',dateRange(view.flight)],['Total due',money(view.total)],['Impressions',num(view.impressions)+(view.partialImpressions?' known':'')]])meta.append(labeled(key,el('strong',value||'Not entered')));p.append(meta,el('p',view.template.rateNote,'muted'));
 for(const [key,title] of [['r4','TV'],['r5','Radio']]){const lines=view.broadcast.filter(l=>l.channel===key);if(!lines.length&&!view.broadcastExpected[key])continue;p.append(el('h3',title));if(lines.length)p.append(paperTable(['Station / program','Rate','Spots/day','Run days','Spots/wk','Weeks','Total ads','Total','Imps'],lines.map(l=>[`${l.station} · ${l.program}`,money(l.rate),num(l.spotsDay),l.runDays,num(l.spotsWeek),num(l.weeks),num(l.spots),money(l.total),num(l.impressions)])));for(const l of lines)p.append(el('p',`${l.station}: ${dateRange(l)} · Audience (000s): ${num(l.audience)} · CPM: ${l.cpm==null?'':`$${num(l.cpm)}`} · ${l.comments}`,'print-comment'));if(view.broadcastDifference[key])p.append(el('p',`${money(view.broadcastDifference[key])} remains to schedule. Campaign allocation: ${money(view.broadcastExpected[key])}.`,'draft-note'));}
 for(const [title,filter] of [['Gross digital media',l=>!l.feeRate],['Net digital media',l=>!!l.feeRate]]){
  const lines=view.lines.filter(l=>l.kind==='digital'&&filter(l));if(!lines.length)continue;p.append(el('h3',title));p.append(paperTable(['Channel / length','Flight / run days','Weeks','Media','Fee','Total','Imps'],lines.map(l=>[`${l.name} · ${l.length}`,`${dateRange(l)} · ${l.runDays}`,num(l.weeks),money(l.media),l.feeRate?`${num(l.feeRate*100)}% · ${money(l.fee)}`:money(l.fee),money(l.allocation),num(l.impressions)])));
  for(const l of lines)if(l.description)p.append(el('p',`${l.name}: ${l.description}`,'print-comment'));
 }
 if(view.lines.some(l=>l.id==='r19')){p.append(el('h3','Selected iHM psychographs'));for(const x of view.psychographs)p.append(el('p',x.name+': '+x.description,'print-comment'));}
 const vendorLines=[...view.broadcast.map(l=>({name:l.station||l.channel,vendor:l.vendor})),...view.lines.filter(l=>l.kind==='digital')];
 if(vendorLines.length){p.append(el('h3','Vendor assignments'));p.append(paperTable(['Station / channel','Vendor / rep'],vendorLines.map(l=>[l.name,vendorLabel(l.vendor)])));}
 const fees=view.lines.filter(l=>l.kind==='fee');if(fees.length)p.append(paperTable(['Other source fees','Amount'],fees.map(l=>[l.name,money(l.allocation)])));
 const totals=el('div','','paper-total');totals.append(el('span','Media + fees · Total due'),el('strong',money(view.total)));p.append(totals);
 const tv=view.broadcastActual.r4,radio=view.broadcastActual.r5,digital=view.lines.filter(l=>l.kind==='digital').reduce((s,l)=>s+l.media,0),media=tv+radio+digital;
 p.append(paperTable(['Media mix','Spend','%'],[['TV',money(tv),media?num(tv/media*100)+'%':''],['Radio',money(radio),media?num(radio/media*100)+'%':''],['Digital',money(digital),media?num(digital/media*100)+'%':'']]));
 p.append(el('h3','Production (separate)'),el('p',`${details.productionDescription} · Cost ${money(details.productionCost)||'Not entered'} · Value ${money(details.productionValue)||'Not entered'}`));
 p.append(el('h3','ZIP codes and acceptance'),el('p',details.zipList||'ZIP-code reference not entered.'),el('p',view.template.zipAcceptance.replace('__________________',details.zipInitials||'__________________')));
 if(view.issues.length)p.append(el('p','Draft: '+view.issues.join(' '),'draft-note'));
 p.append(el('p',view.template.acceptance,'acceptance-copy'));const sign=el('div','','signatures');sign.append(labeled('Signature',el('span',details.signature||'____________________________')),labeled('Date',el('span',shortDate(details.signedDate)||'________________')));p.append(sign);
}

async function openSavedOrder(){
 const params=new URLSearchParams(location.search);
 const query=new URLSearchParams({campaign:params.get('campaign')||'',market:params.get('market')||''});
 const response=await fetch('/api/campaign-order?'+query);
 const view=await response.json();
 if(!response.ok)throw Error(view.error||'Unable to load the saved order.');
 const clientId=view.source.clientId==='weed-man'?'epic3':view.source.clientId||'epic3';
 const historyQuery=new URLSearchParams({view:'historical',clientId,year:String(view.source.year)});
 $('history').href='/campaign/orders?'+historyQuery;
 renderPaper(view);
 $('paper').hidden=false;
 $('print').hidden=false;
 $('status').textContent='View only';
}
$('print').onclick=()=>window.print();
openSavedOrder().catch(error=>{
 $('message').textContent=error.message;
 $('message').hidden=false;
 $('status').textContent='Unable to load';
});
