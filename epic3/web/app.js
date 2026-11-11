'use strict';
let state, selected = 'input:O8', columns = [], busy = false, dirty = false, viewState = {};
let editableAddresses = new Set(), formulaTargets = new Set();
const el = id => document.getElementById(id);
const text = (tag, value, className) => { const n=document.createElement(tag); n.textContent=value; if(className)n.className=className; return n; };
const letters = n => { let s=''; while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s; };
const coords = address => {const m=/^([A-Z]+)([1-9]\d*)$/.exec(address);if(!m)return null;return [Number(m[2]),[...m[1]].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)];};
const addressOf = key => key.replace(/^input:/,'');
const isInput = key => key.startsWith('input:');
const cell = address => state.cells[address] || {input:null,formula:null,value:null,sourceInput:null,sourceFormula:null,sourceValue:null,style:state.layout.styles[address]||0,note:''};
const nodeId = key => 'cell-'+key.replace('input:','input-');
const keyFor = (column,row) => (column.mode==='input'?'input:':'')+letters(column.col)+row;
const editableInput = key => isInput(key)&&editableAddresses.has(addressOf(key))&&!cell(addressOf(key)).formula;
const raw = key => {const c=cell(addressOf(key));return isInput(key)?(editableInput(key)&&c.input!==null?String(c.input):''):(c.formula||(c.input===null?'':String(c.input)));};
const errorValue = value => typeof value==='string'&&/^#(?:DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!|CYCLE!)$/.test(value);
const changed = c => c.formula!==c.sourceFormula||c.input!==c.sourceInput;
const canEditFormula = key => !isInput(key)&&(!!cell(key).formula||(formulaTargets.has(key)&&!editableAddresses.has(key)));
function unavailableInput(key){
 const address=addressOf(key),c=cell(address),[row,col]=coords(address),period=state.periods.find(p=>col>=p.start_column&&col<=p.end_column);
 if(!c.formula)return {label:'Not used',detail:'No manual value is used here.',inputs:[]};
 const spend=period?letters(period.start_column)+row:null,source=state.sources.find(s=>s.workbookId===period?.workbookId);
 const originalSpend=spend?state.targets[spend]?.address:null;
 const cpmFormula=period&&col===period.end_column&&c.formula.replace(/[\s$()]/g,'')===`=${originalSpend}/B${row}*1000`;
 if(cpmFormula)return {label:'Calculated',detail:'Impressions = Spend ÷ CPM × 1,000. Change Spend input or CPM.',inputs:[{key:'input:'+spend,label:'Spend input'},{key:'input:'+letters(source.rateColumn)+row,label:'CPM'}]};
 return {label:'Calculated',detail:'This value comes from a formula. Use Edit formula to change it.',inputs:[]};
}
function closeCellEditor(){const editor=el('cell-editor');if(editor){const td=editor.parentElement;td.classList.remove('editing');td.textContent=format(cell(td.dataset.address));}}
function receive(data){const previous=state?.targets?.[addressOf(selected)];state=data;editableAddresses=new Set(data.planning?.editableInputs||[]);formulaTargets=new Set(data.planning?.formulaTargets||[]);if(previous){const next=Object.keys(data.targets).find(a=>data.targets[a].workbookId===previous.workbookId&&data.targets[a].address===previous.address);if(next)selected=(isInput(selected)?'input:':'')+next;}}
function format(c){
 const v=c.value;if(v===null||v===undefined)return '';if(typeof v!=='number')return String(v);
 const f=state.styles[c.style]?.numberFormat||'General',part=f.split(';')[v<0?1:0]||f.split(';')[0];
 const percent=part.includes('%'),money=part.includes('$'),decimals=(part.match(/\.([0#?]+)/)||[])[1];
 const digits=decimals?Math.min(6,decimals.length):part==='General'?(Number.isInteger(v)?0:2):0;
 let result=new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:part.includes(',')||money}).format(percent?v*100:v);
 if(money)result='$'+result;if(percent)result+='%';return result;
}
function message(value){el('message').textContent=value;el('message').hidden=!value;}
function updateStatus(value,saved=false){el('save-status').textContent=value;el('save-status').classList.toggle('saved',saved);}
function sourceLabel(address){const t=state.targets[address];return t?t.clientName+" · "+t.address:address;}
function currentSources(){const id=el("planning-client").value;return state.sources.filter(s=>!id||s.clientId===id);}
function updateFilters(){
 const sources=new Set(currentSources().map(s=>s.workbookId)),periods=state.periods.filter(p=>sources.has(p.workbookId));
 for(const [id,values,label] of [["market",[...new Set(periods.map(p=>p.market))].sort(),"All markets"],["year",[...new Set(periods.map(p=>String(p.year)))].sort().reverse(),"All years"]]){
  const previous=el(id).value;el(id).replaceChildren(new Option(label,""));for(const value of values)el(id).append(new Option(value,value));el(id).value=values.includes(previous)?previous:"";
 }
}
function visibleColumns(){
 const y=el("year").value,market=el("market").value,full=!y&&!market;
 const result=[{col:1,mode:"label",label:"Channel / budget item"}];
 for(const source of currentSources()){
  const periods=state.periods.filter(p=>p.workbookId===source.workbookId&&(!y||String(p.year)===y)&&(!market||p.market===market));
  if(!periods.length)continue;
  result.push({col:source.rateColumn,mode:"input",label:source.clientName+" · Rates",isRate:true,frozenRate:result.length===1});
  const starts=new Map(periods.map(p=>[p.start_column,p]));
  for(let c=source.rateColumn+1;c<=source.endColumn;c++){
   const p=starts.get(c);
   if(p){result.push({col:c,mode:"input",label:"Spend input",period:p},{col:c,mode:"result",label:"Spend",period:p},{col:c+1,mode:"result",label:"%",period:p},{col:c+2,mode:"input",label:"Manual imps",period:p},{col:c+2,mode:"result",label:"Impressions",period:p});c=p.end_column;}
   else if(full)result.push({col:c,mode:"result",label:String(cell(letters(c)+"2").value||""),period:null});
  }
 }
 return result;
}
function render(){
 const table=el('sheet'),show=el('show-formulas').checked;columns=visibleColumns();table.replaceChildren();table.classList.toggle('formulas-mode',show);
 const client=state.clients.find(c=>c.id===el('planning-client').value),empty=columns.length===1;
 el('planning-empty').hidden=!empty;el('formula-bar').hidden=empty;el('issues-button').disabled=empty;el('loading').hidden=true;
 el('planning-empty').textContent=client?`No workbook data for ${client.name} matches these filters.`:'No workbook data matches these filters.';
 const planCount=new Set(columns.filter(c=>c.period).map(c=>c.period.workbookId)).size;
 el('planning-scope').textContent=(client?client.name:'All clients')+' · '+planCount+' media '+(planCount===1?'plan':'plans')+' shown';
 if(empty){table.hidden=true;el('counts').textContent='No matching workbook data';el('cell-kind').textContent='';el('cell-detail').textContent='';viewState={client:el('planning-client').value,market:el('market').value,year:el('year').value,formulas:show};showIssues(false);return;}
 const cg=document.createElement('colgroup');
 const widths=[34,...columns.map(c=>c.col===1?230:c.frozenRate?80:show&&c.mode==='result'?220:c.label==='%'?66:112)];
 table.style.width=`calc(var(--rownum) + var(--label) + var(--rate) + ${widths.slice(3).reduce((sum,width)=>sum+width,0)}px)`;
 viewState={client:el('planning-client').value,market:el('market').value,year:el('year').value,formulas:show};
 widths.forEach((width,i)=>{const c=document.createElement('col');c.style.width=i===0?'var(--rownum)':columns[i-1].col===1?'var(--label)':columns[i-1].frozenRate?'var(--rate)':width+'px';cg.append(c);});table.append(cg);
 const head=document.createElement('thead'),ltr=document.createElement('tr');ltr.className='letters';ltr.append(text('th','','rownum'));
 for(const c of columns){const role=c.mode==='input'?'Input':c.mode==='result'?'Locked':'';const th=text('th',letters(c.col)+(role?' · '+role:''),c.col===1?'frozen-label':c.frozenRate?'frozen-rate':'');th.scope='col';th.dataset.role=c.mode;ltr.append(th);}head.append(ltr);
 const groups=document.createElement('tr');groups.className='groups';groups.append(text('th','1','rownum'));
 const metric=document.createElement('tr');metric.className='metrics';metric.append(text('th','2','rownum'));
 for(let i=0;i<columns.length;){const c=columns[i];
  if(c.col===1||c.isRate){const th=text('th',c.label,c.col===1?'frozen-label':c.frozenRate?'frozen-rate':'');th.rowSpan=2;th.scope='col';groups.append(th);i++;continue;}
  let span=1;
  if(c.period){while(columns[i+span]?.period?.id===c.period.id)span++;}
  else{const merge=state.layout.merges.find(m=>m.split(':')[0]===letters(c.col)+'1');if(merge){const end=coords(merge.split(':')[1])[1];while(columns[i+span]&&!columns[i+span].period&&columns[i+span].col<=end)span++;}}
  const th=text('th',c.period?c.period.label:String(cell(letters(c.col)+'1').value||''));th.colSpan=span;th.scope='colgroup';th.title=th.textContent;groups.append(th);
  for(let k=0;k<span;k++){const cc=columns[i+k],mh=text('th',cc.label);mh.scope='col';mh.dataset.role=cc.mode;mh.title=cc.mode==='input'?'Click a yellow field to type. Blank gray positions do not accept input.':'Read-only result. Formulas are managed with Edit formula.';metric.append(mh);}i+=span;
 }
 head.append(groups,metric);table.append(head);
 const body=document.createElement('tbody');
 for(let row=3;row<=state.layout.maxRow;row++){
  const tr=document.createElement('tr');tr.dataset.row=row;
  if([21,28,32,33,34,37,42,46,50,52,53,54,55].includes(row))tr.className='summary';
  if([35,39,47,51,59,63,67,69,76,81,83,84,85,86,87].includes(row))tr.className='section-gap';
  if(row>=68)tr.classList.add('note-row');tr.append(text('th',row,'rownum'));
  for(const column of columns){const address=letters(column.col)+row,key=keyFor(column,row),c=cell(address),input=editableInput(key),unavailable=column.mode==='input'&&!input;
   const unavailableInfo=unavailable?unavailableInput(key):null;
   const value=unavailable?'':show&&c.formula&&column.mode==='result'?c.formula:format(c),td=text('td',value);
   td.dataset.address=address;td.dataset.key=key;td.dataset.role=column.mode;td.tabIndex=input&&key===selected?0:-1;td.id=nodeId(key);
   if(unavailable)td.setAttribute('aria-disabled','true');
   td.setAttribute('aria-label',address+' · '+(unavailable?unavailableInfo.detail:input?'Editable input':column.mode==='label'?'Label':'Locked result')+': '+(column.mode==='result'&&c.formula?c.formula+' = ':'')+value);
   td.setAttribute('aria-readonly',String(!input));
   if(column.col===1)td.classList.add('frozen-label');if(column.frozenRate)td.classList.add('frozen-rate');
   if(typeof c.value==='string')td.classList.add('text');
   if(column.mode==='result')td.classList.add('result-cell');
   if(c.formula&&!unavailable)td.classList.add('formula');if(errorValue(c.value)&&!unavailable)td.classList.add('error');if(changed(c)&&!unavailable)td.classList.add('edited');
   if(column.period&&column.mode==='result'&&column.col===column.period.end_column)td.classList.add('group-end');
   if(input)td.classList.add('input-cell');if(unavailable)td.classList.add('not-applicable');if(!unavailable&&key===selected)td.classList.add('selected');
   td.title=[address,unavailable?unavailableInfo.detail:input?'Click to type. Enter saves; Escape cancels.':column.mode==='result'?'Locked result':'Source label',!unavailable?(c.formula||format(c)):'',c.note].filter(Boolean).join('\n');tr.append(td);
  }body.append(tr);
 }
 table.append(body);table.hidden=false;el('loading').hidden=true;
 if(!el(nodeId(selected))||el(nodeId(selected)).classList.contains('not-applicable'))selected=table.querySelector('td.input-cell')?.dataset.key||'A3';
 selectCell(selected);el('counts').textContent=`${state.layout.maxRow} rows · ${columns.length} displayed columns · ${Object.keys(state.planning.addedFormulas).length} completed formulas`;
 el('footer-tip').textContent='Yellow: type here · Blue: locked · Gray: no input';
}
function selectCell(key,focus=false){
 const address=addressOf(key),c=cell(address),node=el(nodeId(key));if(!node||node.classList.contains('not-applicable'))return false;
 closeCellEditor();
 document.querySelectorAll('#sheet td.selected, #sheet td[tabindex="0"]').forEach(n=>{n.classList.remove('selected');n.tabIndex=-1;});
 selected=key;node.classList.add('selected');node.tabIndex=editableInput(key)?0:-1;
 if(!editableInput(key)){const entry=el('sheet').querySelector('td.input-cell');if(entry)entry.tabIndex=0;}
 el('address').value=address;el('formula').value=raw(key);dirty=false;
 const editable=editableInput(key),unavailable=isInput(key)&&!editable,info=unavailable?unavailableInput(key):null;
 el('formula').readOnly=!editable;el('formula').hidden=unavailable;el('formula').placeholder=editable?'Type a value. Enter saves; Escape cancels.':'Blank result · read only';
 el('field-explanation').hidden=!unavailable;el('field-explanation').textContent=info?.detail||'';el('field-actions').replaceChildren();
 for(const target of info?.inputs||[]){if(!editableInput(target.key))continue;const button=text('button',target.label);button.type='button';button.addEventListener('click',()=>{selectCell(target.key,true);editCell();});el('field-actions').append(button);}
 el('save-cell').disabled=true;el('save-cell').hidden=unavailable;el('edit-formula').disabled=!canEditFormula(unavailable?address:key);el('edit-formula').textContent=c.formula?'Edit formula':'Add formula';el('formula').setAttribute('aria-label',editable?'Cell input value':'Locked result, read only');
 el('cell-kind').textContent=sourceLabel(address)+' · '+(editable?'Input':unavailable?info.label:c.formula?'Formula':'Locked');
 el('cell-detail').textContent=editable?'Click and type. Enter saves; Escape cancels.':unavailable?info.detail:c.note||(c.formula?'Locked result. Use Edit formula for a deliberate formula change.':'Read-only result. Enter values in the corresponding yellow input column.');
 if(focus){node.focus({preventScroll:true});reveal(node);}return true;
}
function reveal(node){const wrap=el('sheet-wrap'),nr=node.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),mobile=matchMedia('(max-width:600px)').matches,frozen=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rownum'))+parseInt(getComputedStyle(document.documentElement).getPropertyValue('--label'))+(mobile?0:parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rate')));
 const header=el('sheet').tHead.getBoundingClientRect().height;
 if(nr.top<wr.top+header)wrap.scrollTop-=wr.top+header-nr.top;if(nr.bottom>wr.bottom-16)wrap.scrollTop+=nr.bottom-wr.bottom+16;
 if(!node.classList.contains('frozen-label')&&(mobile||!node.classList.contains('frozen-rate'))){if(nr.left<wr.left+frozen)wrap.scrollLeft-=wr.left+frozen-nr.left;if(nr.right>wr.right-16)wrap.scrollLeft+=nr.right-wr.right+16;}}
function preserveDraft(){if(!dirty)return true;message('Press Enter to save this cell, or Escape to cancel.');(el('cell-editor')||el('formula')).focus();return false;}
async function save(){
 if(busy||!editableInput(selected))return false;if(!dirty)return true;busy=true;el('save-cell').disabled=true;el('formula').disabled=true;if(el('cell-editor'))el('cell-editor').disabled=true;updateStatus('Saving…');message('');
 try{const response=await fetch('/api/planning/cell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state.targets[addressOf(selected)],text:el('formula').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to save.');receive(data);dirty=false;render();renderIssues();updateStatus('Saved locally',true);return true;}
 catch(e){message(e.message);updateStatus('Not saved');return false;}
 finally{busy=false;el('formula').disabled=false;if(el('cell-editor'))el('cell-editor').disabled=false;el('save-cell').disabled=!dirty;}
}
async function moveEditable(direction){
 if(busy)return;
 if(dirty&&!await save()){(el('cell-editor')||el('formula')).focus();return;}
 const cells=[...el('sheet').querySelectorAll('td[data-key]')],start=cells.findIndex(td=>td.dataset.key===selected);
 for(let offset=1;offset<=cells.length;offset++){const td=cells[(start+direction*offset+cells.length)%cells.length];if(td.classList.contains('input-cell')){selectCell(td.dataset.key,true);message('');editCell();return;}}
}
function editCell(){
 if(!editableInput(selected)||busy)return;
 let editor=el('cell-editor');
 if(!editor){const td=el(nodeId(selected));editor=document.createElement('input');editor.id='cell-editor';editor.type='text';editor.inputMode='decimal';editor.autocomplete='off';editor.spellcheck=false;editor.value=el('formula').value;editor.setAttribute('aria-label',addressOf(selected)+' input');editor.placeholder='Enter value';
  editor.addEventListener('input',()=>{el('formula').value=editor.value;el('formula').dispatchEvent(new Event('input'));});
  editor.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();if(dirty)save();else selectCell(selected,true);}else if(e.key==='Escape'){e.preventDefault();selectCell(selected,true);message('');updateStatus('Saved locally',true);}else if(e.key==='Tab'){e.preventDefault();moveEditable(e.shiftKey?-1:1);}});
  td.replaceChildren(editor);td.classList.add('editing');
 }
 editor.focus();editor.select();
}
function goTo(address){
 address=address.trim().replaceAll('$','').toUpperCase();const rc=coords(address);
 if(!rc||rc[0]<3||rc[0]>state.layout.maxRow||rc[1]>state.layout.maxCol){message('Choose a cell between A3 and '+letters(state.layout.maxCol)+state.layout.maxRow+'.');el('address').value=addressOf(selected);return;}
 if(!columns.some(c=>c.col===rc[1])){el('year').value='';el('market').value='';render();}
 const inputKey='input:'+address,key=editableInput(inputKey)&&el(nodeId(inputKey))?inputKey:el(nodeId(address))?address:inputKey;
 if(selectCell(key,true))message('');else{el('address').value=addressOf(selected);message(address+' is unavailable. Choose a yellow input field or a blue result.');}
}
function renderIssues(){
 const sources=new Set(currentSources().map(s=>s.workbookId));
 const errors=Object.entries(state.cells).filter(([a,c])=>errorValue(c.sourceValue)&&sources.has(state.targets[a]?.workbookId));el('issues-button').textContent=`Source issues (${errors.length})`;el('issue-list').replaceChildren();
 for(const [address,c] of errors){const b=document.createElement('button');b.type='button';b.append(text('strong',address),text('span',c.sourceValue,'error-code'));const rc=coords(address),p=state.periods.find(p=>rc[1]>=p.start_column&&rc[1]<=p.end_column);b.append(text('span',p?.label||String(cell('A'+rc[0]).value||'Source calculation'),'issue-label'));b.addEventListener('click',()=>{if(preserveDraft())goTo(address);});el('issue-list').append(b);}
}
el('sheet').addEventListener('pointerdown',e=>{if(e.target.closest('td.not-applicable'))e.preventDefault();});
el('sheet').addEventListener('click',e=>{if(e.target.id==='cell-editor')return;const td=e.target.closest('td[data-key]');if(td&&!td.classList.contains('not-applicable')&&!busy&&preserveDraft()){selectCell(td.dataset.key,true);message('');if(editableInput(selected))editCell();}});
el('sheet').addEventListener('dblclick',e=>{const td=e.target.closest('td[data-key]');if(e.target.id!=='cell-editor'&&td&&!td.classList.contains('not-applicable')&&!busy)editCell();});
el('sheet').addEventListener('keydown',e=>{
 if(e.key==='Tab'){e.preventDefault();moveEditable(e.shiftKey?-1:1);return;}
 if(busy)return;const rc=coords(addressOf(selected)),index=columns.findIndex(c=>keyFor(c,rc[0])===selected);let r=rc[0],i=index;
 if(e.key==='ArrowDown')r++;else if(e.key==='ArrowUp')r--;else if(e.key==='ArrowRight')i++;else if(e.key==='ArrowLeft')i--;else if(e.key==='Enter'||e.key==='F2'){e.preventDefault();editCell();return;}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&editableInput(selected)){editCell();el('cell-editor').value=e.key;el('cell-editor').dispatchEvent(new Event('input'));e.preventDefault();return;}else return;
 e.preventDefault();if(!preserveDraft())return;
 while(r>=3&&r<=state.layout.maxRow&&i>=0&&i<columns.length){if(selectCell(keyFor(columns[i],r),true))break;if(e.key==='ArrowDown')r++;else if(e.key==='ArrowUp')r--;else if(e.key==='ArrowRight')i++;else i--;}
});
el('formula').addEventListener('input',()=>{if(!editableInput(selected))return;if(el('cell-editor'))el('cell-editor').value=el('formula').value;dirty=el('formula').value!==raw(selected);el('save-cell').disabled=!dirty||busy;updateStatus(dirty?'Unsaved cell':'Saved locally',!dirty);});
el('formula').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();moveEditable(e.shiftKey?-1:1);}if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){selectCell(selected,true);message('');updateStatus('Saved locally',true);}});
el('save-cell').addEventListener('click',save);
el('address').addEventListener('keydown',e=>{if(e.key==='Enter'&&preserveDraft())goTo(el('address').value);});
for(const id of ['market','year','show-formulas','planning-client'])el(id).addEventListener('change',()=>{if(dirty||busy||el('formula-dialog').open){el('planning-client').value=viewState.client;el('market').value=viewState.market;el('year').value=viewState.year;el('show-formulas').checked=viewState.formulas;if(dirty)preserveDraft();return;}if(id==='planning-client')updateFilters();message('');render();renderIssues();const url=new URL(location.href);if(el('planning-client').value)url.searchParams.set('client',el('planning-client').value);else url.searchParams.delete('client');history.replaceState(null,'',url.pathname+url.search);});
el('reset-view').addEventListener('click',()=>{if(busy||!preserveDraft())return;el('year').value='';el('market').value='';render();renderIssues();});
function showIssues(show){el('issues').hidden=!show;el('issues-button').setAttribute('aria-expanded',String(show));}
el('issues-button').addEventListener('click',()=>showIssues(el('issues').hidden));el('close-issues').addEventListener('click',()=>showIssues(false));
window.addEventListener('beforeunload',e=>{if(dirty||el('formula-dialog').open){e.preventDefault();e.returnValue='';}});
(async()=>{try{const response=await fetch('/api/planning');if(!response.ok)throw new Error('Unable to open the local database.');receive(await response.json());if(!state.planning)throw new Error('Column update is not installed. Reload after the local app update.');
 for(const client of state.clients)el('planning-client').append(new Option(client.name+(client.active?'':' (inactive)'),client.id));
 const query=new URLSearchParams(location.search),client=query.get('client')||'';if(client&&!state.clients.some(c=>c.id===client))throw Error('This client is not in the directory. Choose All clients to open media planning.');el('planning-client').value=client;
 updateFilters();if(el('year').options.length>1)el('year').selectedIndex=1;render();renderIssues();const target=query.get('cell');if(target&&!el('sheet').hidden)goTo(target);updateStatus('Saved locally',true);
 }catch(e){el('loading').textContent=e.message;message(e.message);updateStatus('Unable to load');}})();
el('edit-formula').addEventListener('click',()=>{const address=addressOf(selected);if(busy||!preserveDraft()||!canEditFormula(address))return;selectCell(address);el('formula-context').textContent=sourceLabel(address)+' · Current result: '+format(cell(address))+' · References use this client’s original workbook addresses.';el('formula-expression').value=cell(address).formula||'=';el('formula-error').hidden=true;el('formula-dialog').showModal();el('formula-expression').focus();});
el('cancel-formula').addEventListener('click',()=>{if(!busy)el('formula-dialog').close();});
el('formula-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
el('formula-editor').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;el('save-formula').disabled=true;el('cancel-formula').disabled=true;el('formula-error').hidden=true;try{const response=await fetch('/api/planning/formula',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state.targets[addressOf(selected)],text:el('formula-expression').value})});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to save formula.');receive(data);el('formula-dialog').close();render();renderIssues();updateStatus('Formula saved locally',true);}catch(error){el('formula-error').textContent=error.message;el('formula-error').hidden=false;}finally{busy=false;el('save-formula').disabled=false;el('cancel-formula').disabled=false;}});
