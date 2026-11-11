'use strict';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const money=n=>n==null?'':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const num=n=>n==null?'':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const shortDate=d=>d?`${+d.slice(5,7)}/${+d.slice(8,10)}/${d.slice(2,4)}`:'';
const dateRange=f=>f.start&&f.end?`${shortDate(f.start)}–${shortDate(f.end)}`:'Dates needed';
let options,directory,view,details,campaignData,dirty=false,busy=false,refreshed=false,sequence=0,lastPreview=Promise.resolve(),invalid=new Set(),opened=new Set(),dateTarget;
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function status(text){$('status').textContent=text;}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data;try{data=await r.json();}catch{throw Error('The local app could not be reached. Your edits are still here.');}if(!r.ok)throw Error(data.error||'Unable to complete the request.');return data;}
function button(text,fn,cls='text-action'){const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;}
function controls(){for(const key of ['save','preview','refresh'])$(key).disabled=busy||!view||invalid.size>0;for(const key of ['campaign','market','open'])$(key).disabled=busy;$('editor').inert=busy;}
function changed(){dirty=true;status('Unsaved changes');controls();}
function payload(){return {campaignId:view.campaignId,marketId:view.marketId,revision:view.revision,sourceRevision:view.sourceRevision,details,refresh:refreshed};}
function readNumber(s,isMoney=false){const v=s.trim().replaceAll('$','').replaceAll(',','');if(!v)return null;if(!/^\d+(?:\.\d+)?$/.test(v))throw Error('Enter a nonnegative number.');if(isMoney&&!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('Use at most two decimal places.');const n=Number(v)*(isMoney?100:1);if(!Number.isFinite(n)||n>100000000000)throw Error('Enter a smaller amount.');return isMoney?Math.round(n):n;}
function editable(target,key,label,{kind='text',choices=[],fallback='',wide=false}={}){
 const wrap=el('span','','editable');wrap.dataset.editKey=label;
 const display=()=>kind==='money'?money(target[key]):kind==='date'?shortDate(target[key]):kind==='number'?num(target[key]):target[key]||fallback;
 const opener=button(display()||'Add',begin,'value-button'+(wide?' wide':''));opener.setAttribute('aria-label',label);wrap.append(opener);
 function begin(){
  let input;
  const current=target[key]??'';
  if(choices.length){input=el('select');input.append(new Option('Choose…',''));for(const choice of [...new Set([current,...choices].filter(Boolean))])input.append(new Option(choice,choice));input.append(new Option('Enter another…','__custom__'));input.value=current;}
  else{input=el(wide?'textarea':'input');if(!wide)input.type=kind==='date'?'date':'text';input.value=kind==='money'&&current!==''?(current/100).toFixed(2):current;}
  input.className='value-input'+(wide?' wide':'');input.setAttribute('aria-label',label);if(kind==='money'||kind==='number')input.inputMode='decimal';opener.replaceWith(input);input.focus();if(input.select)input.select();let committed=false;
  async function commit(){if(committed)return;try{
   if(input.value==='__custom__')return;
   const value=kind==='money'||kind==='number'?readNumber(input.value,kind==='money'):input.value.trim();target[key]=value;invalid.delete(label);committed=true;changed();input.replaceWith(opener);opener.textContent=display()||'Add';await recalculate();
  }catch(e){invalid.add(label);input.setAttribute('aria-invalid','true');message(e.message);controls();}}
  input.addEventListener('change',()=>{if(input.value==='__custom__'){const custom=el('input');custom.className='value-input';custom.setAttribute('aria-label',label);input.replaceWith(custom);input=custom;wire();custom.focus();}else commit();});
  function wire(){input.addEventListener('input',()=>{changed();});input.addEventListener('blur',commit);input.addEventListener('keydown',event=>{
   if(event.key==='Enter'&&!wide){event.preventDefault();commit();}
   if(event.key==='Escape'){committed=true;invalid.delete(label);input.replaceWith(opener);message('');controls();opener.focus();}
  });}wire();
 }
 return wrap;
}
function labeled(label,value){const n=el('div','','meta-field');n.append(el('span',label,'field-label'),value);return n;}
function disclosure(label,id){const n=el('details','','row-details');n.open=opened.has(id);n.append(el('summary',label));n.addEventListener('toggle',()=>n.open?opened.add(id):opened.delete(id));return n;}
function datesControl(target,flight,inheritLabel='Use campaign dates'){
 const n=el('span','','flight-control');n.append(el('span',dateRange(flight)),button('Override dates',()=>{
  dateTarget={target,inheritLabel};$('date-start').value=target.start||flight.start||'';$('date-end').value=target.end||flight.end||'';$('date-reset').textContent=inheritLabel;$('date-error').hidden=true;$('date-dialog').showModal();$('date-start').focus();
 }));return n;
}
function table(headers,cls=''){const t=el('table','',cls),h=el('thead'),r=el('tr');for(const v of headers)r.append(el('th',v));h.append(r);t.append(h);const b=el('tbody');t.append(b);return [t,b];}
function cell(row,value,cls=''){const td=el('td','',cls);if(value instanceof Node)td.append(value);else td.textContent=value;row.append(td);return td;}
function section(title,action){const s=el('section'),h=el('div','','section-heading');h.append(el('h3',title));if(action)h.append(action);s.append(h);return s;}
function currentMedia(line){if(!details.mediaDetails[line.id])details.mediaDetails[line.id]={description:'',length:'',runDays:'',start:'',end:''};return details.mediaDetails[line.id];}
function vendorControls(target,media,label){
 const wrap=el('div','','vendor-controls'),firm=el('select'),rep=el('select');
 firm.setAttribute('aria-label',label+' vendor firm');rep.setAttribute('aria-label',label+' vendor rep');
 firm.append(new Option('Vendor not selected',''));for(const f of directory.firms.filter(f=>f.active||f.id===target.vendor?.firmId))firm.append(new Option(f.name,f.id));firm.value=target.vendor?.firmId||'';
 rep.append(new Option('Rep not selected',''));for(const r of directory.reps.filter(r=>r.firmId===firm.value&&(r.active&&r.coverage.some(c=>c.mediaType===media)||r.id===target.vendor?.repId)))rep.append(new Option(r.name,r.id));rep.value=target.vendor?.repId||'';rep.disabled=!firm.value;
 firm.onchange=()=>{if(firm.value)target.vendor={firmId:firm.value,repId:''};else delete target.vendor;changed();recalculate();};
 rep.onchange=()=>{target.vendor={firmId:firm.value,repId:rep.value};changed();recalculate();};
 wrap.append(labeled('Vendor firm',firm),labeled('Rep',rep));return wrap;
}
function vendorLabel(v){return v?[v.firmName,v.repName,v.email].filter(Boolean).join(' · '):'Vendor not selected';}
function render(){
 if(!view)return;const focus=document.activeElement?.closest('[data-edit-key]')?.dataset.editKey;
 const root=$('editor');root.replaceChildren();$('empty').hidden=true;
 const heading=el('div','','order-heading');heading.append(el('h2',`${view.source.marketName} media order`));const total=el('div','','order-total');total.append(el('span','Total due'),el('strong',money(view.total)));heading.append(total);root.append(heading);
 const context=el('div','','order-context');context.append(el('span','Client: '+(view.source.clientName||'Epic3')),el('span','Brand: '+(view.source.brand??'Weed Man')),el('span',view.source.campaignName));root.append(context);
 const header=el('div','','metadata');
 for(const [key,label,kind,choices] of [['orderNumber','Order number','text',[]],['orderDate','Order date','date',[]],['contact','Contact','text',options.contacts],['email','Email','text',options.emails],['terms','Terms','text',options.terms]])header.append(labeled(label,editable(details,key,label,{kind,choices})));
 root.append(header);
 const flight=el('div','','order-flight');flight.append(labeled('Flight',datesControl(details,view.flight)),el('span',view.flight.weeks==null?'':`${num(view.flight.weeks)} weeks`,'muted'));
 flight.append(el('span',`Scheduled ${money(view.total)} · Campaign media ${money(view.source.budget-view.source.reserve)}`,'muted'));if(view.source.reserve)flight.append(el('span',`Reserve ${money(view.source.reserve)} stays in campaign`,'muted'));root.append(flight);
 const media=section('Digital media');const digital=view.lines.filter(l=>l.kind==='digital');
 if(digital.length){const [t,b]=table(['Channel','Flight','Media','Fee','Total','Est. imps'],'digital-table');
  for(const line of digital){const tr=el('tr'),d=currentMedia(line),name=el('div');name.append(el('strong',line.name));const extra=disclosure('Details','media-'+line.id),fields=el('div','','detail-fields');
   fields.append(labeled('Length',editable(d,'length',line.name+' length',{fallback:line.length,choices:options.formats||[]})),labeled('Run days',editable(d,'runDays',line.name+' run days',{fallback:line.runDays,choices:options.runDays||[]})),labeled('Weeks',el('span',num(line.weeks))));
   fields.append(labeled('Description',editable(d,'description',line.name+' description',{fallback:line.description,wide:true})));extra.append(fields);name.append(vendorControls(d,'digital',line.name));
   if(line.id==='r19'){const profiles=el('div','','psychographs');profiles.append(el('strong','Selected iHM psychographs'));for(const p of view.psychographs)profiles.append(el('p',p.name+': '+p.description));extra.append(profiles);}
   if(line.cpm)extra.append(el('p',`Estimate: $${num(line.cpm)} CPM · ${line.rateSource}`,'muted'));name.append(extra);
   cell(tr,name);cell(tr,datesControl(d,line,'Use order dates'));for(const value of [money(line.media),money(line.fee),money(line.allocation),line.impressions==null?'':num(line.impressions)])cell(tr,value,'number');b.append(tr);
  }media.append(t);
 }else media.append(el('p','No digital media allocated.','muted'));root.append(media);
 const broadcast=section('Broadcast schedules');
 for(const key of ['r4','r5']){
  if(!view.broadcastExpected[key]&&!details.broadcast.some(l=>l.channel===key))continue;
  const channel=key==='r4'?'TV':'Radio',bar=el('div','','broadcast-heading');bar.append(el('strong',channel),el('span',`Budget ${money(view.broadcastExpected[key])} · Scheduled ${money(view.broadcastActual[key])} · Remaining ${money(view.broadcastDifference[key])}`,'muted'),button('Add station',()=>{details.broadcast.push({id:crypto.randomUUID(),channel:key,station:'',program:'',runDays:'',start:'',end:'',comments:view.template.stationNote,rate:null,spotsDay:null,spotsWeek:null,audience:null});changed();recalculate();}));broadcast.append(bar);
  const [t,b]=table(['Station / program','Rate','Spots/wk','Flight','Total','Imps',''],'broadcast-table');
  for(const line of view.broadcast.filter(l=>l.channel===key)){
   const d=details.broadcast.find(l=>l.id===line.id),tr=el('tr'),station=el('div','','station-cell'),prefix=`${channel} ${view.broadcast.filter(l=>l.channel===key).indexOf(line)+1}`;
   const choices=(options.stations[view.marketId]?.[channel]||[]).map(s=>s.value);
   station.append(editable(d,'station',prefix+' station',{choices}),editable(d,'program',prefix+' program',{choices:options.programs?.[channel]||[]}),vendorControls(d,key==='r4'?'broadcast-tv':'broadcast-radio',prefix));
   const extra=disclosure('Details',line.id),fields=el('div','','detail-fields');
   fields.append(labeled('Spots/day',editable(d,'spotsDay',prefix+' spots per day',{kind:'number'})),labeled('Run days',editable(d,'runDays',prefix+' run days',{choices:options.runDays||[]})),labeled('Audience (000s)',editable(d,'audience',prefix+' audience in thousands',{kind:'number'})),labeled('Weeks',el('span',num(line.weeks))),labeled('Total ads',el('span',num(line.spots))),labeled('CPM',el('span',line.cpm==null?'':`$${num(line.cpm)}`)),labeled('Comments',editable(d,'comments',prefix+' comments',{wide:true})));extra.append(fields);station.append(extra);cell(tr,station);
   cell(tr,editable(d,'rate',prefix+' rate',{kind:'money'}),'number');cell(tr,editable(d,'spotsWeek',prefix+' spots per week',{kind:'number'}),'number');cell(tr,datesControl(d,line,'Use order dates'));cell(tr,money(line.total),'number');cell(tr,num(line.impressions),'number');
   const remove=button('×',()=>{details.broadcast=details.broadcast.filter(l=>l.id!==line.id);opened.delete(line.id);changed();recalculate();},'remove');remove.setAttribute('aria-label','Remove '+prefix+' schedule');cell(tr,remove);b.append(tr);
  }
  broadcast.append(t);
 }
 if(!view.broadcastExpected.r4&&!view.broadcastExpected.r5&&!view.broadcast.length)broadcast.append(el('p','No broadcast media allocated.','muted'));root.append(broadcast);
 const other=view.lines.filter(l=>l.kind==='fee');if(other.length){const fees=el('div','','other-fees');for(const line of other)fees.append(el('span',`${line.name}: ${money(line.allocation)}`));root.append(fees);}
 const closing=section('Production and acceptance');const summary=el('div','','closing-fields');
 summary.append(labeled('Production cost',editable(details,'productionCost','Production cost',{kind:'money'})),labeled('Production value',editable(details,'productionValue','Production value',{kind:'money'})),labeled('Description',editable(details,'productionDescription','Production description')),labeled('ZIP-code list / reference',editable(details,'zipList','ZIP-code list or reference',{wide:true})));closing.append(summary,el('p','Production is separate from this media order total.','muted'));
 const acceptance=disclosure('Acceptance details','acceptance');const signatures=el('div','','detail-fields');signatures.append(labeled('ZIP verification initials',editable(details,'zipInitials','ZIP verification initials')),labeled('Signature',editable(details,'signature','Signature')),labeled('Date',editable(details,'signedDate','Signature date',{kind:'date'})));acceptance.append(el('p',view.template.zipAcceptance),el('p',view.template.acceptance),signatures);closing.append(acceptance);root.append(closing);
 if(view.orphanedDetails.length){const retained=disclosure('Retained channel details','retained');for(const id of view.orphanedDetails){const d=details.mediaDetails[id];retained.append(el('p',Object.values(d).filter(Boolean).join(' · ')));}root.append(retained);}
 const foot=el('div','','order-foot');foot.append(el('span',`Media + fees ${money(view.total)}`),el('span',`${num(view.impressions)} ${view.partialImpressions?'known impressions':'impressions'}`));root.append(foot);
 if(view.issues.length){const checks=disclosure(`${view.issues.length} details to complete`,'checks'),list=el('ul');for(const issue of view.issues)list.append(el('li',issue));checks.classList.add('checks');checks.append(list);root.append(checks);}
 if(focus)[...root.querySelectorAll('[data-edit-key]')].find(n=>n.dataset.editKey===focus)?.querySelector('button')?.focus();controls();
}
async function recalculate(){const token=++sequence;lastPreview=(async()=>{try{const result=await api('/api/campaign-order/preview',payload());if(token!==sequence)return false;view=result;if(!invalid.size)message('');if(!document.querySelector('.value-input'))render();return true;}catch(e){if(token===sequence){message(e.message);status('Check order details');}return false;}})();return lastPreview;}
function adopt(result){sequence++;view=result;details=clone(result.details);dirty=false;refreshed=false;invalid.clear();opened.clear();status(result.revision?'Saved draft':'New draft');showPreview(false);render();}
function showPreview(value){$('editor').hidden=value||!view;$('paper').hidden=!value;$('edit').hidden=!value;$('print').hidden=!value;$('preview').hidden=value;}
async function campaignChanged(preferred=''){
 const id=$('campaign').value;$('market').replaceChildren();view=null;details=null;dirty=false;refreshed=false;opened.clear();showPreview(false);$('empty').hidden=false;controls();
 if(!id){$('empty').textContent='Create and save a campaign first.';return;}
 campaignData=await api('/api/campaign?id='+encodeURIComponent(id));for(const row of campaignData.rows)$('market').append(new Option(row.name,row.marketId));if(campaignData.rows.some(r=>r.marketId===preferred))$('market').value=preferred;
}
async function openOrder(){if(busy)return;if(dirty&&!window.confirm('Leave this order without saving?'))return;busy=true;controls();try{const r=await api('/api/campaign-order?campaign='+encodeURIComponent($('campaign').value)+'&market='+encodeURIComponent($('market').value));adopt(r);message('');history.replaceState(null,'','/orders.html?campaign='+encodeURIComponent(r.campaignId)+'&market='+encodeURIComponent(r.marketId));}catch(e){message(e.message);}finally{busy=false;controls();}}
async function save(){if(busy||!view)return;await lastPreview;if(invalid.size)return;busy=true;controls();try{const result=await api('/api/campaign-order',payload());adopt(result);status('Saved locally');message('');}catch(e){message(e.message);status('Not saved');}finally{busy=false;controls();}}
async function refresh(){if(busy||!view)return;await lastPreview;const before=view.source.budget-view.source.reserve;busy=true;controls();try{const result=await api('/api/campaign-order/preview',{...payload(),refresh:true});view=result;refreshed=true;changed();render();message(`Campaign refreshed: media ${money(before)} to ${money(view.source.budget-view.source.reserve)}. Save to keep these changes.`);}catch(e){message(e.message);}finally{busy=false;controls();}}
function paperTable(headers,rows){const [t,b]=table(headers);for(const values of rows){const tr=el('tr');values.forEach((v,i)=>cell(tr,v,i>0?'number':''));b.append(tr);}return t;}
function renderPaper(){
 const p=$('paper');p.replaceChildren();const head=el('div','','paper-header');head.append(el('h2','Final Fore Media'),el('h2','Media order'));p.append(head);
 const meta=el('div','','paper-meta');for(const [key,value] of [['Order number',details.orderNumber],['Order date',shortDate(details.orderDate)],['Client',view.source.clientName||'Epic3'],['Franchise brand',view.source.brand??'Weed Man'],['Franchise market',view.source.marketName],['Contact',details.contact],['Email',details.email],['Terms',details.terms],['Flight',dateRange(view.flight)],['Total due',money(view.total)],['Impressions',num(view.impressions)+(view.partialImpressions?' known':'')]])meta.append(labeled(key,el('strong',value||'Not entered')));p.append(meta,el('p',view.template.rateNote,'muted'));
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
async function preview(){await lastPreview;if(invalid.size)return false;if(!await recalculate())return false;renderPaper();showPreview(true);return true;}
$('open').onclick=openOrder;$('save').onclick=save;$('refresh').onclick=refresh;$('preview').onclick=preview;$('edit').onclick=()=>showPreview(false);$('print').onclick=async()=>{if(await preview())window.print();};
$('market').onchange=()=>{if(dirty&&!window.confirm('Leave this order without saving?')){$('market').value=view.marketId;return;}view=null;details=null;dirty=false;refreshed=false;opened.clear();showPreview(false);$('empty').hidden=false;status('Create / open order');controls();};
$('campaign').onchange=async()=>{if(dirty&&!window.confirm('Leave this order without saving?')){$('campaign').value=view.campaignId;return;}try{await campaignChanged();}catch(e){message(e.message);}};
$('date-cancel').onclick=()=>$('date-dialog').close();
$('date-reset').onclick=()=>{dateTarget.target.start='';dateTarget.target.end='';$('date-dialog').close();changed();recalculate();};
$('date-form').onsubmit=e=>{e.preventDefault();const start=$('date-start').value,end=$('date-end').value;if(!start||!end||end<start||+start.slice(0,4)!==view.source.year||+end.slice(0,4)!==view.source.year){$('date-error').textContent=`Choose dates in ${view.source.year}, with the end on or after the start.`;$('date-error').hidden=false;return;}Object.assign(dateTarget.target,{start,end});$('date-dialog').close();changed();recalculate();};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'&&$('paper').hidden&&view){e.preventDefault();preview();}});
(async()=>{try{const [catalog,list,parties]=await Promise.all([api('/api/campaign-order/options'),api('/api/campaigns'),api('/api/directory')]);options=catalog;directory=parties.directory;$('campaign').append(new Option('Choose campaign…',''));for(const c of list.campaigns)$('campaign').append(new Option(c.name,c.id));const q=new URLSearchParams(location.search),id=q.get('campaign');if(list.campaigns.some(c=>c.id===id))$('campaign').value=id;else if(list.campaigns.length===1)$('campaign').value=list.campaigns[0].id;await campaignChanged(q.get('market')||'');if(id&&q.get('market'))await openOrder();controls();}catch(e){message(e.message);}})();
