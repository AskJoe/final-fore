'use strict';
const $=id=>document.getElementById(id),make=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const params=new URLSearchParams(location.search),isClients=location.pathname==='/clients.html';
const collection=isClients?'clients':['firms','reps','stations'].includes(params.get('view'))?params.get('view'):'firms';
const names={clients:['Client','Clients'],firms:['Firm','Firms'],reps:['Rep','Reps'],stations:['Station / property','Stations & properties']};
const roles={'rep-firm':'Rep firm','station-owner':'Station owner','direct-vendor':'Direct vendor'};
let data,page=0,editing=null,busy=false,dirty=false;
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||'Unable to save.');return result;}
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function lookup(kind,id){return data.directory[kind].find(r=>r.id===id);}
function mediaName(id){return data.mediaTypes.find(m=>m.id===id)?.name||id;}
function coverageText(c){return [mediaName(c.mediaType),data.channels.find(x=>x.id===c.channelId)?.name,lookup('stations',c.stationId)?.name,c.market||'Market not specified'].filter(Boolean).join(' · ');}
function cell(row,value){const n=make('td');if(value instanceof Node)n.append(value);else n.textContent=value;row.append(n);return n;}
function details(row){const d=make('details'),summary=make('summary','Notes & source');d.append(summary);if(row.notes)d.append(make('p',row.notes));if(row.source)d.append(make('p',row.source));return d;}
function render(){
 const firm=$('firm-filter').value,media=$('media-filter').value,status=$('active-filter').value,q=$('search').value.trim().toLowerCase();
 const rows=data.directory[collection].filter(r=>{
  if(status==='active'&&!r.active||status==='inactive'&&r.active)return false;
  if(firm&&!(r.firmId===firm||r.ownerFirmId===firm||r.repFirmId===firm))return false;
  if(media&&!(r.mediaType===media||r.coverage?.some(c=>c.mediaType===media)))return false;
  const searchable=[r.name,r.email,r.brand,r.market,r.network,r.notes,lookup('firms',r.firmId)?.name,lookup('firms',r.ownerFirmId)?.name,lookup('firms',r.repFirmId)?.name,...(r.coverage||[]).map(coverageText)].join(' ').toLowerCase();
  return !q||searchable.includes(q);
 });
 page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));$('status').textContent=`${rows.length} ${names[collection][1].toLowerCase()}${data.referenceOnly?' · Reference data; directory not yet saved':''}`;
 const headers={clients:['Client / brand','Franchise markets','Status',''],firms:['Firm','Role','Reps','Status',''],reps:['Rep','Firm','Coverage','Status',''],stations:['Station / property','Media / market','Owner','Rep firm','Status','']}[collection];
 const head=make('tr');headers.forEach(h=>head.append(make('th',h)));$('table-head').replaceChildren(head);$('table-body').replaceChildren();
 for(const row of rows.slice(page*50,page*50+50)){
  const tr=make('tr'),title=make('div');title.append(make('strong',row.name));
  if(collection==='clients')title.append(make('small',row.brand||'Brand not specified'));
  if(collection==='reps'){if(row.email)title.append(make('small',row.email));if(row.phone)title.append(make('small',row.phone));}
  if(row.notes||row.source)title.append(details(row));cell(tr,title);
  if(collection==='clients'){
   const list=make('div');list.append(make('span',`${row.marketIds.length} franchise markets`));const d=make('details');d.append(make('summary','View markets'));d.append(make('p',row.marketIds.map(id=>data.markets.find(m=>m.id===id)?.name||id).join(' · ')));list.append(d);cell(tr,list);
  }
  if(collection==='firms'){
   cell(tr,row.roles.map(r=>roles[r]).join(' · '));const link=make('a',`${data.directory.reps.filter(r=>r.firmId===row.id).length} reps`);link.href='/vendors.html?view=reps&firm='+encodeURIComponent(row.id);cell(tr,link);
  }
  if(collection==='reps'){
   cell(tr,lookup('firms',row.firmId)?.name||'Unknown firm');const cover=make('div');for(const c of row.coverage)cover.append(make('div',coverageText(c)));if(!row.coverage.length)cover.textContent='Coverage not specified';cell(tr,cover);
  }
  if(collection==='stations'){
   const market=make('div',mediaName(row.mediaType));market.append(make('small',row.market),make('small',row.network));cell(tr,market);cell(tr,lookup('firms',row.ownerFirmId)?.name||'Not specified');cell(tr,lookup('firms',row.repFirmId)?.name||'Not specified');
  }
  cell(tr,row.active?'Active':'Inactive');const edit=make('button','Edit');edit.type='button';edit.setAttribute('aria-label','Edit '+row.name);edit.onclick=()=>openEditor(row);cell(tr,edit);[...tr.children].forEach((td,i)=>td.dataset.label=headers[i]);$('table-body').append(tr);
 }
 if(!rows.length){const tr=make('tr'),td=cell(tr,'No records match these filters.');td.colSpan=headers.length;$('table-body').append(tr);}
 $('previous').disabled=page===0;$('next').disabled=(page+1)*50>=rows.length;$('page-count').textContent=rows.length?`${page*50+1}–${Math.min((page+1)*50,rows.length)} of ${rows.length}`:'0 records';
}
function field(parent,label,key,value,{type='text',wide=false,choices=null,multiple=false,required=false}={}){
 const wrap=make('label',label,wide?'wide':'');let input;
 if(choices){input=make('select');input.multiple=multiple;if(!multiple)input.append(new Option('Choose…',''));for(const c of choices)input.append(new Option(c.name,c.id));if(multiple)for(const o of input.options)o.selected=(value||[]).includes(o.value);else input.value=value||'';}
 else{input=make(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;if(type==='checkbox'){input.checked=!!value;wrap.classList.add('check-label');}else input.value=value??'';}
 input.name=key;input.required=required;input.setAttribute('aria-label',label);wrap.append(input);parent.append(wrap);return input;
}
function coverageRow(parent,value={mediaType:'digital',channelId:'',stationId:'',market:'',notes:''}){
 const row=make('div','','coverage-row');parent.append(row);
 const media=field(row,'Media type','coverage-media',value.mediaType,{choices:data.mediaTypes,required:true});
 const channel=field(row,'Channel (optional)','coverage-channel',value.channelId,{choices:data.channels.map(c=>({id:c.id,name:c.name}))});
 const station=field(row,'Station / property (optional)','coverage-station',value.stationId,{choices:data.directory.stations.map(s=>({id:s.id,name:`${s.name} · ${s.market}`})),wide:true});
 const market=field(row,'Market / territory (optional)','coverage-market',value.market,{wide:true});
 field(row,'Coverage notes','coverage-notes',value.notes,{type:'textarea',wide:true});
 const updateChoices=()=>{for(const o of channel.options)o.hidden=!!o.value&&!(media.value==='broadcast-tv'?o.value==='r4':media.value==='broadcast-radio'?o.value==='r5':data.channels.find(c=>c.id===o.value)?.kind==='digital');for(const o of station.options)o.hidden=!!o.value&&lookup('stations',o.value)?.mediaType!==media.value;};
 media.onchange=()=>{channel.value='';station.value='';updateChoices();};station.onchange=()=>{const s=lookup('stations',station.value);if(s){media.value=s.mediaType;market.value=s.market;channel.value='';updateChoices();}};updateChoices();
 const remove=make('button','Remove coverage');remove.type='button';remove.onclick=()=>{row.remove();dirty=true;};row.append(remove);
}
function openEditor(record){
 editing=record?structuredClone(record):{name:'',active:true,notes:'',source:''};dirty=false;
 $('record-title').textContent=(record?'Edit ':'Add ')+names[collection][0].toLowerCase();$('form-error').hidden=true;const fields=$('record-fields');fields.replaceChildren();
 field(fields,'Name','name',editing.name,{required:true,wide:true});
 if(collection==='clients'){
  field(fields,'Franchise brand','brand',editing.brand,{wide:true});field(fields,'Franchise markets','marketIds',editing.marketIds||[],{choices:data.markets.map(m=>({id:m.id,name:m.name+(m.current?'':' (historical)')})),multiple:true,wide:true});fields.append(make('p','Markets represent the client’s franchises. Shared historical markets can remain in the planning catalog without assigning ownership.','hint wide'));
 }
 if(collection==='firms')field(fields,'Firm roles','roles',editing.roles||[],{choices:Object.entries(roles).map(([id,name])=>({id,name})),multiple:true,required:true,wide:true});
 if(collection==='reps'){
  field(fields,'Firm','firmId',editing.firmId,{choices:data.directory.firms,required:true,wide:true});field(fields,'Email','email',editing.email,{type:'email'});field(fields,'Phone','phone',editing.phone);
  const coverage=make('section','','coverage-editor');coverage.append(make('h3','Media coverage'),make('p','Add each media type, channel, or station separately. A blank market means the territory has not been specified.','hint'));const rows=make('div');rows.id='coverage-rows';coverage.append(rows);for(const c of editing.coverage||[])coverageRow(rows,c);const add=make('button','Add coverage');add.type='button';add.onclick=()=>{coverageRow(rows);dirty=true;};coverage.append(add);fields.append(coverage);
 }
 if(collection==='stations'){
  field(fields,'Media type','mediaType',editing.mediaType,{choices:data.mediaTypes,required:true});field(fields,'Market','market',editing.market);field(fields,'Network / affiliation','network',editing.network);field(fields,'Owner firm','ownerFirmId',editing.ownerFirmId,{choices:data.directory.firms});field(fields,'Rep firm','repFirmId',editing.repFirmId,{choices:data.directory.firms});
 }
 field(fields,'Active','active',editing.active,{type:'checkbox',wide:true});field(fields,'Notes','notes',editing.notes,{type:'textarea',wide:true});
 if(editing.source)fields.append(make('p','Source: '+editing.source,'hint wide'));
 $('record-dialog').showModal();fields.querySelector('input').focus();
}
function collect(){
 const result={...editing},form=$('record-form');
 for(const input of $('record-fields').querySelectorAll('input,select,textarea')){
  if(input.name.startsWith('coverage-'))continue;
  result[input.name]=input.type==='checkbox'?input.checked:input.multiple?[...input.selectedOptions].map(o=>o.value):input.value;
 }
 if(collection==='reps')result.coverage=[...form.querySelectorAll('.coverage-row')].map(row=>Object.fromEntries(['mediaType','channelId','stationId','market','notes'].map((key,i)=>[key,row.querySelector(`[name="coverage-${['media','channel','station','market','notes'][i]}"]`).value])));
 return result;
}
async function load(){data=await api('/api/directory');$('reference-note').hidden=isClients;$('add-record').disabled=false;const selected=$('firm-filter').value||params.get('firm')||'';$('firm-filter').replaceChildren(new Option('All firms',''));for(const firm of [...data.directory.firms].sort((a,b)=>a.name.localeCompare(b.name)))$('firm-filter').append(new Option(firm.name,firm.id));$('firm-filter').value=selected;render();}
$('record-form').oninput=()=>{dirty=true;};
$('record-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;$('save-record').disabled=true;$('cancel').disabled=true;$('record-fields').inert=true;try{await api('/api/directory/entity',{collection,entity:collect(),revision:data.revision});dirty=false;$('record-dialog').close();await load();message('');}catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}finally{busy=false;$('save-record').disabled=false;$('cancel').disabled=false;$('record-fields').inert=false;}};
$('record-dialog').addEventListener('cancel',event=>{if(busy||dirty&&!confirm('Discard these unsaved changes?'))event.preventDefault();else dirty=false;});
$('cancel').onclick=()=>{if(!dirty||confirm('Discard these unsaved changes?')){dirty=false;$('record-dialog').close();}};
$('add-record').onclick=()=>openEditor(null);$('previous').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};for(const id of ['search','media-filter','firm-filter','active-filter'])$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;render();});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
(async()=>{try{
 $('page-title').textContent=isClients?'Clients':'Vendors';document.title=$('page-title').textContent+' | Final Fore';$('intro').textContent=isClients?'Clients own the franchise locations you plan for.':'Manage vendor firms, their reps, and the stations or channels they cover. Station ownership and sales representation are separate relationships.';
 $('add-record').textContent='Add '+names[collection][0].toLowerCase();$('media-label').hidden=!['reps','stations'].includes(collection);$('firm-label').hidden=!['reps','stations'].includes(collection);
 if(!isClients){$('directory-tabs').hidden=false;for(const key of ['firms','reps','stations']){const link=make('a',names[key][1]);link.href='/vendors.html?view='+key;if(key===collection)link.setAttribute('aria-current','page');$('directory-tabs').append(link);}}
 await load();for(const m of data.mediaTypes)$('media-filter').append(new Option(m.name,m.id));
}catch(error){message(error.message);$('status').textContent='Unable to load directory.';}})();
