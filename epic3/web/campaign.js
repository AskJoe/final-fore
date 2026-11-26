'use strict';
const $=id=>document.getElementById(id);
const make=(tag,value='',cls='')=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
const currency=c=>c==null?'':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const percent=n=>n==null?'':new Intl.NumberFormat('en-US',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(n);
const remainingBudgetLabel='Budget remaining';
const dateText=s=>s?`${Number(s.slice(5,7))}/${Number(s.slice(8,10))}/${s.slice(2,4)}`:'';
const clone=x=>JSON.parse(JSON.stringify(x));
let catalog,draft,view,blankDraft,dirty=false,saving=false,valid=true,sequence=0,pending=false;
let workflow='',savedCampaigns=[],broadcastScope,broadcastBudget;
let expanded=new Set(),invalidInputs=new Map();
const inputKey=input=>input.id||input.getAttribute('aria-label');
const recoveryPrefix='ffm.campaign.recovery.v1.',activeCampaignKey='ffm.campaign.active.v1';
const workflowKey='ffm.campaign.workflow.v1';
let autosaveTimer,saveTask=null,editVersion=0,recoveryAvailable=true,lastRecalculation=Promise.resolve();

async function api(path,body){
 const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{throw Error('The app could not be reached. Your edits are still on this page.');}
 if(!response.ok)throw Error(data.error||'Unable to complete the request.');return data;
}
// The last server answers are kept on this computer so the page can open from them at
// once and then check the server for changes. The sign-in page clears them.
const savedCopies='ffm-campaign-saved-v1';
async function savedRead(path){try{const hit=await (await caches.open(savedCopies)).match(path);return hit?await hit.json():null;}catch{return null;}}
function savedWrite(path,data){try{caches.open(savedCopies).then(store=>store.put(path,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}))).catch(()=>{});}catch{}}
async function load(path){const data=await api(path);savedWrite(path,data);return data;}
function remote(path){const fresh=load(path);fresh.catch(()=>{});return {saved:savedRead(path),fresh};}
// campaign-calc.js is the server's own calculation. Once it has the catalog and channel
// history, edits recalculate here; until then, and if it ever fails, the server does it.
let calculator=null;
function useCalculator(history){
 try{window.FinalForeCampaign.load(catalog,history);calculator=window.FinalForeCampaign;}catch{calculator=null;}
}
async function preview(details){
 if(calculator){
  let local=null;try{local=calculator.preview(details,catalog.clients);}catch{}
  if(local){if(local.ok)return local.result;throw Error(local.message);}
 }
 return api('/api/campaign/preview',details);
}
function message(value){$('message').textContent=value;$('message').hidden=!value;}
function status(value){$('save-status').textContent=value;}
const isBroadcast=()=>workflow==='broadcast';
const isWorkflow=value=>value==='digital'||value==='broadcast';
const activeKey=()=>activeCampaignKey+(isBroadcast()?'.broadcast':'');
function planUrl(type=workflow,id){
 const params=new URLSearchParams();if(type)params.set('workflow',type);if(id)params.set('id',id);
 return '/campaign.html'+(params.size?'?'+params:'');
}
function buttons(){
 const legacy=workflow==='digital';
 $('save-campaign').hidden=legacy;$('save-campaign').disabled=legacy||saving||!valid||!!invalidInputs.size||!dirty;
 if(legacy)for(const field of document.querySelectorAll(
  '#campaign-name,#campaign-year,#campaign-budget,#campaign-start,#campaign-end,#client,#regions input,'+
  '#market-rows input,#market-rows select,#market-rows .remove,#market-rows .amount-edit,#market-rows .reset-budget,#add-market'
 ))field.disabled=true;
 $('new-campaign').hidden=workflow==='digital';$('new-campaign').disabled=saving;$('campaign-picker').disabled=saving;
 $('campaign-main').inert=false;
 if(draft){
  $('campaign-calendar').href=calendarUrl();
  $('order-list').href=ordersUrl();$('order-history').href=ordersUrl(null,'historical');
  document.querySelectorAll('a.market-order').forEach(link=>{link.href=ordersUrl(link.closest('[data-market]').dataset.market,null,link.dataset.section);});
 }
}
function campaignScope(){
 const params=new URLSearchParams({clientId:draft.clientId==='weed-man'?'epic3':draft.clientId,year:String(draft.year),workflow});
 if(draft.id)params.set('campaignId',draft.id);
 return params;
}
function calendarUrl(){return '/campaign/calendar?'+campaignScope();}
function ordersUrl(marketId,view,section){
 const params=campaignScope();
 if(marketId)params.set('marketId',marketId);
 if(view)params.set('view',view);
 if(section)params.set('section',section);
 return '/campaign/orders?'+params;
}
function rememberCampaign(id){try{localStorage.setItem(activeKey(),id||'new');}catch{}}
function recoveryKey(id){return recoveryPrefix+(id||(isBroadcast()?'new.broadcast':'new'));}
function pendingEditor(){
 const input=document.activeElement;if(!input||!('value' in input)||!input.dataset.userEdited)return null;
 const settings={'campaign-name':'name','campaign-year':'year','campaign-budget':'budget','campaign-start':'start','campaign-end':'end'};
 if(settings[input.id])return {kind:'setting',key:settings[input.id],inputKey:inputKey(input),value:input.value};
 if(input.dataset.channelFocus){const [marketId,channelId]=input.dataset.channelFocus.split(':');return {kind:'channel',marketId,key:channelId,inputKey:input.dataset.channelFocus,value:input.value};}
 const market=input.closest('[data-market]');
 if(market&&input.dataset.key)return {kind:'market',marketId:market.dataset.market,key:input.dataset.key,inputKey:inputKey(input),value:input.value};
 if(input.closest('#regions'))return {kind:'region',region:input.closest('section').querySelector('strong').textContent,key:input.getAttribute('aria-label').endsWith(' start')?'start':'end',inputKey:inputKey(input),value:input.value};
 return null;
}
function applyPendingEditor(edit){
 if(!edit)return;
 try{
  const value=edit.key==='budget'||edit.key==='override'||edit.kind==='channel'?readMoney(edit.value):edit.key==='year'?Number(edit.value):edit.value;
  if(edit.kind==='setting')draft[edit.key]=value;
  else if(edit.kind==='region'){draft.regions[edit.region]??={start:'',end:''};draft.regions[edit.region][edit.key]=value;}
  else{
   const market=draft.markets.find(m=>m.marketId===edit.marketId);if(!market)return;
   if(edit.kind==='channel'){market.channels??={};market.channels[edit.key]=value;}else market[edit.key]=value;
  }
  invalidInputs.delete(edit.inputKey);
 }catch(error){invalidInputs.set(edit.inputKey,edit.value);throw error;}
}
function cacheRecovery(){
 if(!draft||!dirty)return true;
 try{
  localStorage.setItem(recoveryKey(draft.id),JSON.stringify({details:draft,base:view.details,pending:pendingEditor(),invalid:[...invalidInputs],updatedAt:Date.now()}));
  rememberCampaign(draft.id);recoveryAvailable=true;return true;
 }catch{recoveryAvailable=false;return false;}
}
function readRecovery(id){try{return JSON.parse(localStorage.getItem(recoveryKey(id))||'null');}catch{return null;}}
function removeRecovery(id){try{localStorage.removeItem(recoveryKey(id));}catch{}}
function cacheCampaignView(){
 if(!draft)return;
 try{localStorage.setItem('ffm.campaign.view.v1.'+(draft.id||'new'),JSON.stringify({expanded:[...expanded],search:$('market-search').value,region:$('region-filter').value}));}catch{}
}
function restoreCampaignView(fresh=false){
 let saved=null;try{if(!fresh)saved=JSON.parse(localStorage.getItem('ffm.campaign.view.v1.'+(draft.id||'new'))||'null');}catch{}
 expanded=new Set(saved?.expanded||[]);$('market-search').value=saved?.search||'';$('region-filter').value=saved?.region||'';renderRows();
}
function queueAutosave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveCampaign(),700);}
function markDirty(){dirty=true;editVersion++;status('Saving…');buttons();queueMicrotask(cacheRecovery);queueAutosave();}
function readMoney(value){
 const cleaned=value.trim().replaceAll('$','').replaceAll(',','');
 if(!cleaned)return null;
 if(!/^\d+(?:\.\d{0,2})?$/.test(cleaned))throw Error('Enter a nonnegative dollar amount with at most two decimal places.');
 const [whole,fraction='']=cleaned.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(result)||result>100000000000)throw Error('Enter a smaller dollar amount.');return result;
}
function inputError(input,error){invalidInputs.set(inputKey(input),input.value);input.setAttribute('aria-invalid','true');message(error.message);markDirty();}
function clearInputError(input){invalidInputs.delete(inputKey(input));input.removeAttribute('aria-invalid');}
async function withBroadcastBudget(result,cached=false){
 if(!isBroadcast())return result;
 const {clientId,year}=result.details;
 const scope=new URLSearchParams({view:'campaign-budget',clientId,year:String(year)}).toString();
 const path='/api/orders?'+scope;
 if(scope!==broadcastScope||!broadcastBudget){
  broadcastScope=scope;
  const pending=load(path);
  broadcastBudget=pending;
  pending.catch(()=>{if(broadcastBudget===pending)broadcastBudget=null;});
 }
 const fresh=broadcastBudget;
 const budget=(cached?await savedRead(path):null)??await fresh;
 const rows=result.rows.map(row=>{
  const {actual,broadcast,digital,placements}=budget.markets[row.marketId]??{};
  const allocation=row.override;
  return {...row,actual,broadcast,digital,weatherReserve:row.channels?.r3??null,placements,allocation};
 });
 const byMarket=new Map(rows.map(row=>[row.marketId,row]));
 for(const row of rows){
  const owner=byMarket.get(row.sharedBudgetMarketId);
  if(!owner)continue;
  row.budgetOwner=owner.name;
  (owner.sharedMarkets??=[]).push(row);
 }
 for(const row of rows){
  const group=[row,...(row.sharedMarkets??[])];
  row.gap=row.allocation==null||!group.some(market=>market.actual!=null)?null:
   row.allocation-group.reduce((total,market)=>total+(market.actual??0),0);
 }
 const sum=key=>rows.reduce((total,row)=>total+(row[key]??0),0);
 const proposed=result.details.budget??sum('allocation');
 const media=Object.fromEntries(['broadcast','weatherReserve','digital'].map(key=>[key,rows.some(row=>row[key]!=null)?sum(key):null]));
 return {...result,rows,proposed,actual:sum('actual'),media,allocated:sum('allocation'),remaining:proposed-sum('allocation')};
}
async function calculatePreview(rebuild=false){
 const token=++sequence;pending=true;buttons();
 try{
  const result=await withBroadcastBudget(await preview(draft));
  if(token!==sequence)return;
  if(isBroadcast())draft.markets=result.details.markets;
  view=result;valid=true;if(!invalidInputs.size)message('');
  if(rebuild)renderRows();else updateRows();
  renderSummary();
 }catch(error){if(token!==sequence)return;valid=false;message(error.message);}
 finally{if(token===sequence){pending=false;buttons();}}
}
function recalculate(rebuild=false){lastRecalculation=calculatePreview(rebuild);return lastRecalculation;}
function selectOptions(select,values,emptyLabel){
 select.replaceChildren();if(emptyLabel!==undefined){const o=make('option',emptyLabel);o.value='';select.append(o);}
 for(const value of values){const o=make('option',value);o.value=value;select.append(o);}
}
function settings(){
 const clientId=draft.clientId==='weed-man'?'epic3':draft.clientId;
 $('client').replaceChildren();for(const c of catalog.clients.filter(c=>c.active||c.id===clientId))$('client').append(new Option(c.name+(c.active?'':' (inactive)'),c.id));$('client').value=clientId;
 $('client-brand').value=catalog.clients.find(c=>c.id===clientId)?.brand||'';
 $('campaign-name').value=draft.name;$('campaign-year').value=draft.year;$('campaign-budget').value=currency(isBroadcast()?view.proposed:draft.budget);
 $('campaign-start').value=draft.start;$('campaign-end').value=draft.end;
 $('regions').replaceChildren();
 for(const region of catalog.regions){
  const section=make('section');section.append(make('strong',region));
  for(const key of ['start','end']){
   const label=make('label',key==='start'?'Start':'End');const input=make('input');input.type='date';input.value=draft.regions[region]?.[key]||'';
   input.setAttribute('aria-label',`${region} ${key}`);
   input.addEventListener('input',markDirty);
   input.addEventListener('change',()=>{draft.regions[region]??={start:'',end:''};draft.regions[region][key]=input.value;markDirty();recalculate();});
   label.append(input);section.append(label);
  }
  const source=catalog.markets.find(m=>m.region===region&&m.referenceStart);
  if(source)section.append(make('small',`2026 reference: ${dateText(source.referenceStart)}–${dateText(source.referenceEnd)}`));
  $('regions').append(section);
 }
}
function renderSummary(){
 $('market-count').textContent=draft.markets.length;$('allocated').textContent=currency(view.allocated);
 $('remaining').textContent=view.remaining==null?'':currency(Math.abs(view.remaining));
 $('remaining-wrap').firstChild.textContent=view.remaining<0?'Over budget ':isBroadcast()?'Unassigned ':'Remaining ';
 $('remaining-wrap').classList.toggle('over',view.remaining<0);
 $('counts').textContent=`${draft.markets.length} markets`;
 if(isBroadcast()){
  $('campaign-actual').textContent=currency(view.actual);
  $('campaign-broadcast-actual').textContent=currency(view.media.broadcast)||'—';
  $('campaign-digital-actual').textContent=currency(view.media.digital)||'—';
  const weatherReserve=view.details.weatherReserve??view.media.weatherReserve;
  $('campaign-weather-reserve').textContent=currency(weatherReserve)||'—';
  $('campaign-media-available').hidden=weatherReserve==null;
  $('campaign-media-available-total').textContent=currency(view.proposed-(weatherReserve??0));
  $('campaign-market-weather').hidden=view.media.weatherReserve==null||view.media.weatherReserve===weatherReserve;
  $('campaign-market-weather-total').textContent=currency(view.media.weatherReserve);
  $('campaign-gap').textContent=currency(view.proposed-view.actual);
  const missing=view.rows.filter(row=>row.allocation==null&&!row.budgetOwner).length;
  $('incomplete').textContent=missing?`${missing} ${missing===1?'market needs':'markets need'} a budget`:'';
  if(document.activeElement!==$('campaign-budget')&&!invalidInputs.has('campaign-budget'))$('campaign-budget').value=currency(view.proposed);
  return;
 }
 const needs=[];
 if(draft.budget==null)needs.push('Enter total budget to fill allocations');
 else if(view.needsAllocation)needs.push(`${view.needsAllocation} ${view.needsAllocation===1?'market needs':'markets need'} an allocation`);
 if(draft.budget!=null&&view.needsDates)needs.push(`${view.needsDates} ${view.needsDates===1?'market needs':'markets need'} dates`);
 $('incomplete').textContent=needs.join(' · ');
 $('history-label').textContent=view.years.length?`History ${view.years[0]}–${view.years.at(-1)}`:'No earlier budget history';
}
function field(row,key,label,type='text'){
 const input=make('input','','inline-input');input.type=type;input.dataset.key=key;input.setAttribute('aria-label',`${row.name} ${label}`);
 if(type==='date')input.value=row[key]||'';
 else{input.inputMode='decimal';input.value=currency(row.allocation);input.dataset.displayed=input.value;}
 if(invalidInputs.has(inputKey(input))){input.value=invalidInputs.get(inputKey(input));input.setAttribute('aria-invalid','true');}
 input.addEventListener('input',markDirty);
 input.addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();input.blur();}
  if(event.key==='Escape'){
   const stored=view.rows.find(r=>r.marketId===row.marketId);input.value=key==='override'?currency(stored.allocation):stored[key];
   clearInputError(input);input.blur();buttons();
  }
 });
 const commit=()=>{
  const target=draft.markets.find(r=>r.marketId===row.marketId);
  try{
   if(key==='override'){
    if(input.value===input.dataset.displayed)return;
    target.override=readMoney(input.value);
    input.value=currency(target.override);input.dataset.displayed=input.value;
   }else target[key]=input.value;
   clearInputError(input);markDirty();recalculate();
  }catch(error){inputError(input,error);}
 };
 input.addEventListener('change',commit);
 input.addEventListener('blur',()=>{
  if(key==='override')commit();
 });
 return input;
}
function detailRow(row){
 const tr=make('tr','','channel-expansion');tr.dataset.detail=row.marketId;
 const td=make('td');td.colSpan=8;tr.append(td);
 const top=make('div','','channel-summary');
 top.append(make('strong',row.name),make('span',`Allocated ${currency(row.channelPlan.allocated)}`));
 const balance=make('span',`${row.channelPlan.remaining<0?'Over budget':'Remaining'} ${currency(Math.abs(row.channelPlan.remaining||0))}`);balance.classList.toggle('over',row.channelPlan.remaining<0);top.append(balance);
 const history=make('details','','market-history');history.append(make('summary','History'));
 const old=marketHistoryRow(row);history.append(old.querySelector('.history-content'));top.append(history);
 const order=make('button','Create / open order','text-action');order.type='button';
 order.addEventListener('click',async()=>{await flushCampaign();if(!draft.id||dirty){message('The campaign must finish saving before opening its order.');$('save-campaign').focus();return;}location.href='/orders.html?campaign='+encodeURIComponent(draft.id)+'&market='+encodeURIComponent(row.marketId);});top.append(order);td.append(top);
 const table=make('table','','channel-table');table.setAttribute('aria-label',row.name+' channel allocations');
 const head=make('thead'),hr=make('tr');for(const label of ['Channel','Historical avg.','Allocation $','Budget %','Est. impressions'])hr.append(make('th',label));head.append(hr);table.append(head);
 const body=make('tbody');table.append(body);
 const target=draft.markets.find(m=>m.marketId===row.marketId);target.channels??={};
 // The source list stays visible even when a market has never bought a channel.
 // Zero spend does not create an override or a forecast rate.
 const planned=new Map(row.channelPlan.rows.map(channel=>[channel.id,channel]));
 const hasHistory=row.channelPlan.rows.some(channel=>channel.history.length);
 for(const sourceChannel of catalog.channels){
  const existing=planned.get(sourceChannel.id);
  const channel=existing?{...existing,
   allocation:existing.automatic&&row.allocation!=null?(existing.allocation??0):existing.allocation,
   share:existing.share??(row.allocation>0?0:null)}:{...sourceChannel,automatic:true,average:hasHistory?0:null,
   allocation:row.allocation==null?null:0,share:row.allocation>0?0:null,history:[],impressions:null};
  const line=make('tr');line.dataset.channel=channel.id;
  const label=make('td');label.append(make('span',channel.name));
  const more=make('details','','channel-history');more.append(make('summary','History'));
  const text=make('div');
  for(const year of channel.history){const a=make('a',`${year.year}: ${percent(year.share)}`);a.href=row.channelPlan.sourceUrl+'&range='+encodeURIComponent(year.sources[0]||'A1');a.target='_blank';a.rel='noopener';a.title=year.headers.join('; ');text.append(a);}
  if(channel.cpm)text.append(make('span',`Estimate: $${channel.cpm.toFixed(2)} CPM · ${channel.rateSource}`));
  if(channel.feeRate)text.append(make('span',`${percent(channel.feeRate)} fee on media included`));
  more.append(text);if(channel.history.length)label.append(more);line.append(label);
  line.append(make('td',percent(channel.average),'number'));
  const amount=make('td','','number'),wrap=make('div','','channel-amount');amount.append(wrap);
  const key=`${row.marketId}:${channel.id}`,editLabel=`${row.name} ${channel.name} allocation`;
  const button=make('button',invalidInputs.has(key)?invalidInputs.get(key):currency(channel.allocation),'amount-edit');button.type='button';button.dataset.channelFocus=key;button.setAttribute('aria-label',editLabel);if(invalidInputs.has(key))button.setAttribute('aria-invalid','true');
  function edit(){
   const input=make('input','','channel-dollar');input.inputMode='decimal';input.setAttribute('aria-label',editLabel);input.dataset.channelFocus=key;
   input.value=invalidInputs.get(key)??(channel.allocation==null?'':(channel.allocation/100).toFixed(2));if(invalidInputs.has(key))input.setAttribute('aria-invalid','true');
   button.replaceWith(input);input.focus();input.select();let committed=false;
   async function commit(next=false){
    if(committed)return;
    try{
     const amount=readMoney(input.value);invalidInputs.delete(key);committed=true;
     if(amount===channel.allocation){input.replaceWith(button);buttons();}
     else{target.channels[channel.id]=amount;markDirty();await recalculate();}
     const fields=[...document.querySelectorAll('.amount-edit')];const index=fields.findIndex(b=>b.dataset.channelFocus===key);(fields[index+(next===-1?-1:next?1:0)]||fields[index])?.focus();
    }catch(error){invalidInputs.set(key,input.value);input.setAttribute('aria-invalid','true');message(error.message);markDirty();}
   }
   input.addEventListener('input',()=>{markDirty();invalidInputs.set(key,input.value);buttons();});
   input.addEventListener('blur',()=>commit());
   input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();commit(e.key==='Tab'?(e.shiftKey?-1:1):false);}if(e.key==='Escape'){committed=true;invalidInputs.delete(key);input.replaceWith(button);message('');buttons();button.focus();}});
  }
  button.addEventListener('click',edit);wrap.append(button);
  if(!channel.automatic){const reset=make('button','Reset','text-action reset-channel');reset.type='button';reset.setAttribute('aria-label',`Reset ${row.name} ${channel.name}`);reset.onclick=()=>{target.channels[channel.id]=null;invalidInputs.delete(key);markDirty();recalculate();};wrap.append(reset);}
  line.append(amount,make('td',percent(channel.share),'number'),make('td',channel.impressions==null?'':channel.impressions.toLocaleString('en-US'),'number'));body.append(line);
 }
 td.append(table);return tr;
}

function marketHistoryRow(row){
 const tr=make('tr','','history-row');tr.dataset.detail=row.marketId;
 const td=make('td');td.colSpan=8;const content=make('div','','history-content');
 const left=make('div');
 if(row.history.some(h=>h.budget!=null)){
  const table=make('table');table.setAttribute('aria-label',row.name+' budget history');
  const head=make('thead'),headRow=make('tr');headRow.append(make('th',''));
  for(const h of row.history)headRow.append(make('th',h.year));headRow.append(make('th','Average'));head.append(headRow);table.append(head);
  const body=make('tbody');
  for(const key of ['budget','share']){
   const line=make('tr');line.append(make('th',key==='budget'?'Gross budget':'Market share'));
   for(const h of row.history)line.append(make('td',key==='budget'?currency(h.budget):percent(h.share)));
   line.append(make('td',key==='share'?percent(row.average):''));body.append(line);
  }
  table.append(body);left.append(table);
  left.append(make('p','Each year compares the markets in this campaign. Missing years are excluded from the average. Automatic amounts are scaled to the remaining budget.'));
 }else left.append(make('p','No gross-budget history in the budget source. Enter an allocation for this market.'));
 const right=make('div');const budget=make('p','2027 budget reference','reference');budget.append(make('strong',row.budget2027==null?'Not supplied':currency(row.budget2027)));right.append(budget);
 if(row.referenceStart)right.append(make('p',`2026 regional dates: ${dateText(row.referenceStart)}–${dateText(row.referenceEnd)}`));
 if(row.buyingGroup)right.append(make('p',`Buying group: ${row.buyingGroup}`));
 if(row.budgetSourceRow){const a=make('a','View budget source');a.href=catalog.budgetSourceUrl+'&range=A'+row.budgetSourceRow+':N'+row.budgetSourceRow;a.target='_blank';a.rel='noopener';right.append(a);}
 if(row.startOverride||row.endOverride){
  const reset=make('button','Use inherited dates');reset.type='button';reset.style.marginLeft='12px';
  reset.addEventListener('click',()=>{const target=draft.markets.find(r=>r.marketId===row.marketId);target.start='';target.end='';markDirty();recalculate();});right.append(reset);
 }
 content.append(left,right);td.append(content);tr.append(td);return tr;
}
function rowMatches(row){const q=$('market-search').value.trim().toLowerCase(),region=$('region-filter').value;return (!q||row.name.toLowerCase().includes(q))&&(!region||(region==='unassigned'?!row.region:row.region===region));}
function renderRows(){
 const body=$('market-rows');body.replaceChildren();const rows=view.rows.filter(rowMatches);
 const assigned=new Set(catalog.clients.find(c=>c.id===$('client').value)?.marketIds||[]);
 for(const row of rows){
  const tr=make('tr');tr.dataset.market=row.marketId;
  if(isBroadcast())tr.setAttribute('role','row');
  const cell=(label,cls='')=>{const td=make('td','',cls);td.dataset.label=label;
   if(isBroadcast())td.setAttribute('role','cell');
   tr.append(td);return td;};
  const name=make('span',row.name);
  const channels=make('button','Channels','text-action market-channels');channels.type='button';channels.setAttribute('aria-expanded',expanded.has(row.marketId));channels.setAttribute('aria-label',`${row.name} channels`);
  channels.addEventListener('click',()=>{
   if(expanded.has(row.marketId)){expanded.delete(row.marketId);tr.nextElementSibling?.dataset.detail===row.marketId&&tr.nextElementSibling.remove();}
   else{expanded.add(row.marketId);tr.after(detailRow(view.rows.find(r=>r.marketId===row.marketId)));}
   channels.setAttribute('aria-expanded',expanded.has(row.marketId));
   cacheCampaignView();buttons();
  });
  const market=cell('Market');market.append(name);
  if(isBroadcast()){
   if(assigned.has(row.marketId)){
    const links=make('div','','market-order-links');
    for(const [section,label] of [['broadcast','Broadcast'],['digital','Digital']]){
     const link=make('a',label,'market-order');link.dataset.section=section;
     link.href=ordersUrl(row.marketId,null,section);link.setAttribute('aria-label',row.name+' '+label+' order');
     links.append(link);
    }
    market.append(links);
   }
   market.append(make('small',placementCount(row),'market-placement-count'));
  }else market.append(channels);
  const region=make('select','','inline-input');selectOptions(region,catalog.regions,'');region.value=row.region;region.setAttribute('aria-label',row.name+' region');
  region.addEventListener('change',()=>{draft.markets.find(r=>r.marketId===row.marketId).region=region.value;markDirty();recalculate();});cell('Region').append(region);
  cell('Start').append(field(row,'start','start','date'));cell('End').append(field(row,'end','end','date'));
  if(isBroadcast()){
   cell('Broadcast','number market-broadcast').textContent=currency(row.broadcast)||'—';
   cell('Weather reserve','number market-weather').textContent=currency(row.weatherReserve)||'—';
   cell('Digital','number market-digital').textContent=currency(row.digital)||'—';
  }else{
   const average=cell($('baseline-heading').textContent,'number average');
   average.textContent=percent(row.average);
   average.classList.toggle('blank-result',row.average==null);
  }
  const amount=make('div','','amount-cell');amount.classList.toggle('manual',!isBroadcast()&&!row.automatic);
  if(!row.budgetOwner)amount.append(field(row,'override',isBroadcast()?'proposed budget':'allocation'));
  const reset=make('button','Reset','reset-budget');reset.type='button';reset.hidden=row.automatic;reset.setAttribute('aria-label',`Reset ${row.name} allocation`);reset.title='Use the automatic allocation';
  reset.addEventListener('click',()=>{draft.markets.find(r=>r.marketId===row.marketId).override=null;markDirty();recalculate();});
  if(!isBroadcast())amount.append(reset);
  else budgetFlag(amount,row);
  cell(isBroadcast()?'Proposed':'Allocation',isBroadcast()?'number market-proposed':'number').append(amount);
  const share=cell(isBroadcast()?'Actual':'Budget %','number share');share.textContent=isBroadcast()?currency(row.actual):percent(row.share);share.classList.toggle('blank-result',!isBroadcast()&&row.share==null);
  if(isBroadcast()){const gap=cell(remainingBudgetLabel,'number market-gap');gap.textContent=currency(row.gap);
   gap.title='Proposed budget minus saved order totals, including fees.';
   if(row.sharedMarkets?.length)gap.title+=' Includes '+row.sharedMarkets.map(market=>market.name).join(', ')+'.';
   body.append(tr);continue;}
  const remove=make('button','×','remove');remove.type='button';remove.setAttribute('aria-label',`Remove ${row.name}`);
  remove.addEventListener('click',()=>{draft.markets=draft.markets.filter(r=>r.marketId!==row.marketId);expanded.delete(row.marketId);for(const n of tr.querySelectorAll('input'))invalidInputs.delete(inputKey(n));markDirty();recalculate(true);});cell('Remove').append(remove);
  body.append(tr);if(expanded.has(row.marketId))body.append(detailRow(row));
 }
 $('empty-filter').hidden=!!rows.length;$('visible-count').textContent=rows.length===view.rows.length?'':`${rows.length} of ${view.rows.length} markets · totals include all`;
 if(!isBroadcast())buttons();
}
function budgetFlag(container,row){
 const previous=container.querySelector('.market-budget-note');
 const note=row.budgetOwner?'Shared with '+row.budgetOwner:row.allocation==null?'Missing budget':
  row.sharedMarkets?.length?'Includes '+row.sharedMarkets.map(market=>market.name).join(', '):'';
 if(!note){previous?.remove();return;}
 const label=previous??make('small','','market-budget-note');
 label.textContent=note;
 label.classList.toggle('market-budget-missing',row.allocation==null&&!row.budgetOwner);
 if(!previous)container.append(label);
}
const placementCount=row=>row.placements?`${row.placements} ${row.placements===1?'placement':'placements'}`:
 row.actual==null?'No saved order':'Draft · no placements';
function updateRows(){
 for(const row of view.rows){
  const tr=[...$('market-rows').children].find(n=>n.dataset.market===row.marketId);if(!tr)continue;
  if(!isBroadcast()){
   const amount=tr.querySelector('.amount-cell');amount.classList.toggle('manual',!row.automatic);amount.querySelector('button').hidden=row.automatic;
  }
  for(const input of tr.querySelectorAll('input')){
   if(input===document.activeElement||invalidInputs.has(inputKey(input)))continue;
   input.value=input.dataset.key==='override'?currency(row.allocation):row[input.dataset.key]||'';input.dataset.displayed=input.value;
  }
  if(isBroadcast()){
   tr.querySelector('.share').textContent=currency(row.actual);
   tr.querySelector('.market-broadcast').textContent=currency(row.broadcast)||'—';
   tr.querySelector('.market-weather').textContent=currency(row.weatherReserve)||'—';
   tr.querySelector('.market-digital').textContent=currency(row.digital)||'—';
   tr.querySelector('.market-gap').textContent=currency(row.gap);
   budgetFlag(tr.querySelector('.amount-cell'),row);
   tr.querySelector('.market-placement-count').textContent=placementCount(row);
   continue;
  }
  tr.querySelector('.average').textContent=percent(row.average);tr.querySelector('.average').classList.toggle('blank-result',row.average==null);
  tr.querySelector('.share').textContent=percent(row.share);tr.querySelector('.share').classList.toggle('blank-result',row.share==null);
  if(expanded.has(row.marketId)&&tr.nextElementSibling?.dataset.detail===row.marketId)tr.nextElementSibling.replaceWith(detailRow(row));
 }
}
function adopt(result){
 clearTimeout(autosaveTimer);
 sequence++;pending=false;view=result;draft=clone(result.details);dirty=false;valid=true;invalidInputs.clear();expanded.clear();
 settings();renderSummary();renderRows();message('');status(draft.id?'Saved locally':'New campaign');buttons();
 $('campaign-picker').value=draft.id||'';
 rememberCampaign(draft.id);
}
async function campaignList(loaded){
 savedCampaigns=loaded??(await load('/api/campaigns')).campaigns;
 const select=$('campaign-picker');select.replaceChildren(new Option('Select draft',''));
 for(const c of savedCampaigns.filter(c=>(c.workflow??'digital')===workflow))select.append(new Option(c.name,c.id));
 select.value=draft?.id||'';
}
function discard(){return !dirty||window.confirm('Leave this campaign without saving your changes?');}
async function openCampaign(id,{fresh=false,loaded=null,cached=false}={}){
 const recovery=fresh||!isBroadcast()?null:readRecovery(id);
 const path='/api/campaign?id='+encodeURIComponent(id);
 const result=id?(loaded||(cached?await savedRead(path):null)||await load(path)):isBroadcast()
  ? await preview({...blankDraft.details,workflow,markets:[]}):clone(blankDraft);
 adopt(await withBroadcastBudget(result,cached));
 if(recovery?.details){
  draft=clone(recovery.details);invalidInputs=new Map(recovery.invalid||[]);
  try{applyPendingEditor(recovery.pending);}catch{}
  try{view=await withBroadcastBudget(await preview(draft));valid=true;}
  catch(error){valid=false;message(error.message);if(recovery.base)try{view=await withBroadcastBudget(await preview(recovery.base));}catch{}}
  dirty=true;editVersion++;settings();renderRows();renderSummary();status('Recovered changes');buttons();
  if(recovery.pending&&invalidInputs.has(recovery.pending.inputKey)){
   const input=[...document.querySelectorAll('input')].find(e=>inputKey(e)===recovery.pending.inputKey);
   if(input){input.value=recovery.pending.value;input.setAttribute('aria-invalid','true');}
  }
  cacheRecovery();if(valid&&!invalidInputs.size)queueAutosave();
 }
 restoreCampaignView(fresh);
 history.replaceState(null,'',planUrl(workflow,id));
}
async function saveCampaign(){
 clearTimeout(autosaveTimer);
 if(saveTask)return saveTask;
 if(!isBroadcast()||!dirty)return true;
 // Keep inline channel editing in place until Enter, Tab, or blur commits it.
 if(document.activeElement?.classList.contains('channel-dollar')){cacheRecovery();return false;}
 try{applyPendingEditor(pendingEditor());}catch(error){message(error.message);status('Check amount');cacheRecovery();buttons();return false;}
 if(!valid||invalidInputs.size){status('Changes kept on this computer');cacheRecovery();return false;}
 const submitted=clone(draft),version=editVersion,oldId=draft.id;
 if(isBroadcast()){
  submitted.budget??=view.proposed;
  const rows=new Map(view.rows.map(row=>[row.marketId,row]));
  for(const item of submitted.markets)item.override??=rows.get(item.marketId)?.allocation??null;
 }
 cacheRecovery();saving=true;status('Saving…');buttons();
 saveTask=(async()=>{
  try{
   const stored=await api('/api/campaign',submitted);savedWrite('/api/campaign?id='+encodeURIComponent(stored.details.id),stored);
   const result=await withBroadcastBudget(stored);
   draft.id=result.details.id;draft.revision=result.details.revision;draft.channelVersion=result.details.channelVersion;
   rememberCampaign(draft.id);cacheCampaignView();history.replaceState(null,'',planUrl(workflow,draft.id));
   if(version===editVersion){
    sequence++;pending=false;view=result;draft=clone(result.details);dirty=false;
    for(const input of document.querySelectorAll('input'))delete input.dataset.userEdited;
    removeRecovery(oldId);removeRecovery(draft.id);updateRows();renderSummary();message('');status('Saved locally');
   }else{if(oldId!==draft.id)removeRecovery(oldId);cacheRecovery();status('Saving…');}
   await campaignList();return true;
  }catch(error){message(error.message+' Your changes are kept on this computer.');status('Not saved to database');cacheRecovery();return false;}
  finally{saving=false;saveTask=null;buttons();if(dirty&&version!==editVersion&&valid&&!invalidInputs.size)queueAutosave();}
 })();
 return saveTask;
}
async function flushCampaign(){
 if(document.activeElement?.matches('input,select'))document.activeElement.blur();
 await lastRecalculation;
 if(saveTask)await saveTask;
 return saveCampaign();
}
document.addEventListener('input',event=>{if(event.target.matches('input'))event.target.dataset.userEdited='true';},true);
$('campaign-settings').addEventListener('submit',event=>event.preventDefault());
$('client').addEventListener('change',()=>{
 const client=catalog.clients.find(c=>c.id===$('client').value);if(!client)return;
 const oldId=draft.clientId==='weed-man'?'epic3':draft.clientId;
 if(draft.markets.length&&!confirm(isBroadcast()?'Change the campaign client and load its market targets?':'Change the campaign client? Existing market allocations remain; review that they belong in this client’s campaign.')){$('client').value=oldId;return;}
 draft.clientId=client.id;draft.clientName=client.name;draft.brand=client.brand;$('client-brand').value=client.brand;
 if(isBroadcast()){draft.markets=[];draft.budget=null;}
 else if(!draft.markets.length)draft.markets=catalog.markets.filter(m=>client.marketIds.includes(m.id)).map(m=>({marketId:m.id,region:m.region,start:'',end:'',override:null}));
 markDirty();recalculate(true);
});
for(const [id,key] of [['campaign-name','name'],['campaign-year','year'],['campaign-budget','budget'],['campaign-start','start'],['campaign-end','end']]){
 const input=$(id);input.addEventListener('input',()=>{if(key==='name')draft.name=input.value;markDirty();});
 const commit=()=>{try{
  const oldYear=draft.year;const value=key==='budget'?readMoney(input.value):key==='year'?Number(input.value):input.value;
  const changed=draft[key]!==value;draft[key]=value;
  if(key==='budget')input.value=currency(value);
  if(key==='year'&&draft.name===`Weed Man ${oldYear}`){draft.name=`Weed Man ${draft.year}`;$('campaign-name').value=draft.name;}
  clearInputError(input);if(changed){markDirty();recalculate();}else buttons();
 }catch(error){inputError(input,error);}};
 input.addEventListener('change',commit);
 if(key==='budget')input.addEventListener('blur',commit);
}
$('market-search').addEventListener('input',()=>{renderRows();cacheCampaignView();});$('region-filter').addEventListener('change',()=>{renderRows();cacheCampaignView();});
$('new-campaign').addEventListener('click',async()=>{if(!isBroadcast())return;await flushCampaign();if(discard()){removeRecovery(null);openCampaign('',{fresh:true}).catch(e=>message(e.message));}});
$('campaign-picker').addEventListener('change',async()=>{const id=$('campaign-picker').value;await flushCampaign();if(dirty&&!cacheRecovery()){$('campaign-picker').value=draft.id||'';return;}try{await openCampaign(id);}catch(error){message(error.message);$('campaign-picker').value=draft.id||'';}});
$('save-campaign').addEventListener('click',flushCampaign);
async function followCampaignLink(event){
 const link=event.target.closest('a');if(!link||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const marketId=link.classList.contains('market-order')?link.closest('[data-market]').dataset.market:null;
 event.preventDefault();cacheCampaignView();await flushCampaign();
 if(dirty&&!cacheRecovery()){message('Unable to save this draft. Keep this page open and try Save draft again.');return;}
 location.href=!draft?link.href:marketId?ordersUrl(marketId,null,link.dataset.section):link.id==='campaign-calendar'?calendarUrl():
  link.id==='order-list'?ordersUrl():link.id==='order-history'?ordersUrl(null,'historical'):link.href;
}
document.querySelector('.workbook-nav').addEventListener('click',followCampaignLink);
$('campaign-calendar').addEventListener('click',followCampaignLink);
$('campaign-order-links').addEventListener('click',followCampaignLink);
$('market-rows').addEventListener('click',event=>{
 if(event.target.closest('a.market-order'))void followCampaignLink(event);
});
$('add-market').addEventListener('click',()=>{
 const selected=new Set(draft.markets.map(r=>r.marketId));const choice=$('market-choice');choice.replaceChildren();
 for(const m of catalog.markets.filter(m=>!selected.has(m.id)).sort((a,b)=>a.name.localeCompare(b.name))){const o=make('option',`${m.name} (${m.buyingGroup})`);o.value=m.id;choice.append(o);}
 const custom=make('option','Create a new market…');custom.value='custom';choice.append(custom);$('custom-name').value='';$('add-error').hidden=true;
 changeMarketChoice();$('add-dialog').showModal();choice.focus();
});
function changeMarketChoice(){const id=$('market-choice').value;$('custom-name-label').hidden=id!=='custom';$('new-region').value=catalog.markets.find(m=>m.id===id)?.region||'';}
$('market-choice').addEventListener('change',changeMarketChoice);
$('cancel-add').addEventListener('click',()=>$('add-dialog').close());
$('add-form').addEventListener('submit',event=>{
 event.preventDefault();const id=$('market-choice').value;
 if(id==='custom'&&!$('custom-name').value.trim()){$('add-error').textContent='Enter a market name.';$('add-error').hidden=false;return;}
 const row={marketId:id==='custom'?'custom-'+crypto.randomUUID():id,region:$('new-region').value,start:'',end:'',override:null};
 if(id==='custom')row.name=$('custom-name').value.trim();draft.markets.push(row);$('add-dialog').close();$('market-search').value='';$('region-filter').value='';markDirty();recalculate(true);
});
window.addEventListener('beforeunload',event=>{cacheCampaignView();if(dirty&&!cacheRecovery()){event.preventDefault();event.returnValue='';}});
window.addEventListener('pageshow',event=>{if(event.persisted&&draft&&isBroadcast()){broadcastBudget=null;void recalculate();}});
$('campaign-workflow').addEventListener('change',async event=>{
 const next=event.target.value;if(!isWorkflow(next)||next===workflow)return;
 if(workflow&&draft){
  await flushCampaign();
  if(dirty&&!cacheRecovery()){event.target.value=workflow;message('Save this draft before changing campaign type.');return;}
  location.assign(planUrl(next));return;
 }
 await initialize(next);
});
async function initialize(selected){
 const params=new URLSearchParams(location.search),requested=params.get('id');
 let rememberedType='';try{rememberedType=localStorage.getItem(workflowKey)||'';}catch{}
 const chosen=selected||params.get('workflow')||(requested?rememberedType:'broadcast');
 $('campaign-workflow').disabled=true;
 $('loading').textContent='Loading campaign…';$('loading').hidden=false;
 try{
  // Each answer is read twice: the copy saved on this computer, then the server.
  const catalogData=remote('/api/campaign/catalog'),listData=remote('/api/campaigns'),historyData=remote('/api/campaign/history');
  const campaignData=id=>id?remote('/api/campaign?id='+encodeURIComponent(id)):null;
  let likely=requested||'',campaign=campaignData(likely);
  if(requested&&!params.has('workflow')){
   const saved=(await listData.saved)?.campaigns.find(c=>c.id===requested);
   workflow=(saved??(await listData.fresh).campaigns.find(c=>c.id===requested))?.workflow??'broadcast';
  }else workflow=isWorkflow(chosen)?chosen:'broadcast';
  $('campaign-workflow').value=workflow;
  try{localStorage.setItem(workflowKey,workflow);}catch{}
  const broadcast=isBroadcast(),main=$('campaign-main');main.dataset.workflow=workflow;
  $('campaign-media-summary').hidden=!broadcast;
  main.querySelectorAll('[data-media-column]').forEach(column=>{column.hidden=!broadcast;});
  main.querySelectorAll('[data-legacy-history]').forEach(element=>{element.hidden=broadcast;});
  $('add-market').hidden=broadcast;$('allocation-note').hidden=broadcast;$('campaign-actual-wrap').hidden=!broadcast;$('campaign-gap-wrap').hidden=!broadcast;
  if(broadcast){
   $('campaign-budget-label').textContent='Proposed';$('campaign-budget').placeholder='';
   main.querySelector('.summary-line').prepend(main.querySelector('.budget-field'));
   $('allocated-label').textContent='Market targets';$('target-heading').textContent='Proposed';
   $('actual-heading').textContent='Actual';$('last-heading').textContent=remainingBudgetLabel;
  }
  let remembered='';try{remembered=localStorage.getItem(activeKey())||'';}catch{}
  if(remembered==='new')remembered='';
  // The campaign most likely to open is requested with the catalog and list. It is
  // used only once the list confirms it belongs to this workflow.
  if(!campaign){likely=remembered;campaign=campaignData(likely);}
  let history=null;
  const calculate=value=>{if(value)history=value;if(catalog&&history)useCalculator(history);};
  const campaignToOpen=list=>{
   const available=list.campaigns.filter(c=>(c.workflow??'digital')===workflow);
   return [requested,remembered].find(id=>id&&available.some(c=>c.id===id))||available[0]?.id||'';
  };
  const show=async(data,list,loaded,cached=false)=>{
   catalog=data.catalog;blankDraft=data.draft;calculate();
   await campaignList(list.campaigns);
   const id=campaignToOpen(list);
   await openCampaign(id,{loaded:id&&id===likely?loaded:null,cached});
   main.hidden=false;$('campaign-actions').hidden=false;$('campaign-order-links').hidden=false;$('loading').hidden=true;
   return id;
  };
  const text=value=>JSON.stringify(value??null);
  const [savedCatalog,savedList,savedCampaign,savedHistory]=await Promise.all([catalogData.saved,listData.saved,campaign?campaign.saved:null,historyData.saved]);
  let shown=null;
  if(savedCatalog&&savedList&&(!requested||campaignToOpen(savedList)===requested)){
   calculate(savedHistory);
   try{shown={id:await show(savedCatalog,savedList,savedCampaign,true)};}catch{}
  }
  historyData.fresh.then(calculate,()=>{});
  let fresh;
  try{fresh=await Promise.all([catalogData.fresh,listData.fresh,campaign?campaign.fresh.catch(()=>null):null]);}
  catch(error){
   if(!shown)throw error;
   // fetch rejects with a TypeError when the server cannot be reached at all.
   message((error instanceof TypeError?'Final Fore could not be reached.':error.message)+' Showing the copy kept on this computer.');status('Offline copy');return;
  }
  const [freshCatalog,freshList,freshCampaign]=fresh;
  if(!shown){await show(freshCatalog,freshList,freshCampaign);return;}
  // The saved copy is already on screen. Replace it only where the server differs,
  // and never underneath edits in progress.
  const current=(draft?.id||'')===shown.id;
  const catalogChanged=text(freshCatalog)!==text(savedCatalog);
  const campaignChanged=!!shown.id&&shown.id===likely&&text(freshCampaign)!==text(savedCampaign);
  const selectionChanged=campaignToOpen(freshList)!==shown.id;
  if(!catalogChanged&&!campaignChanged&&!selectionChanged){
   if(text(freshList)!==text(savedList))await campaignList(freshList.campaigns);
   if(current&&isBroadcast()&&broadcastBudget)broadcastBudget.then(()=>{
    if((draft?.id||'')===shown.id&&!dirty&&!saving)void recalculate();
   },()=>{});
   return;
  }
  if(current&&!dirty&&!saving){await show(freshCatalog,freshList,freshCampaign);return;}
  catalog=freshCatalog.catalog;blankDraft=freshCatalog.draft;calculate();await campaignList(freshList.campaigns);
  if(current&&campaignChanged&&freshCampaign?.details.revision!==draft.revision)message('This campaign changed in another window. Reopen it before saving.');
 }catch(error){$('loading').textContent=error.message;status('Unable to load');}
 finally{$('campaign-workflow').disabled=false;}
}
initialize();
