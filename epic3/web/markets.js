'use strict';
let state,selected='',busy=false,dirty=false,columns=[],visibleRows=[],lastView='',lastMarket='';
const el=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
const letters=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
const coords=a=>{const m=/^([A-Z]+)([1-9]\d*)$/.exec(a);return m?[Number(m[2]),[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)]:null;};
const editable=a=>state.editable[a]&&!cell(a).formula;
const isVariables=()=>location.hash==='#variables';
const cell=a=>state.cells[a]||{value:null,input:null,formula:null,style:0};
const money=v=>typeof v==='number'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v):String(v??'');
const iso=v=>typeof v==='number'?new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10):'';
const dateLabel=v=>{const s=iso(v);return s?`${s.slice(5,7)}/${s.slice(8,10)}/${s.slice(0,4)}`:String(v??'');};
const error=v=>typeof v==='string'&&/^#(?:DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!|CYCLE!)$/.test(v);
const headers={C:'Market / order',D:'Goal proposal date',E:'Proposal date',F:'Approved date',G:'Digital start',H:'Digital end',I:'Digital weeks',K:'Broadcast start',L:'Broadcast end',M:'Broadcast weeks',O:'Radio trade (non-paid)',P:'Gross radio',Q:'Gross TV',R:'Gross digital',S:'Gross paid media',T:'Net media · 15% pool',U:'Fee · 15% pool',V:'Net media · 7.5% pool',W:'Fee · 7.5% pool',Z:'Total due incl. fees',AA:'Weekly payment',AD:'Source approved budget',AE:'Budget less total due',AP:'February amount',AQ:'February weeks',AR:'March amount',AS:'March weeks',AT:'April amount',AU:'April weeks',AV:'May amount',AW:'May weeks',AX:'June amount',AY:'June weeks',BA:'Monthly total'};
const variableHeaders={A:'Market / order',B:'Goal proposal date',C:'Proposal date',D:'Approved date',E:'Digital start',F:'Digital end',G:'Digital weeks',H:'Broadcast start',I:'Broadcast end',J:'Broadcast weeks',K:'February weeks',L:'March weeks',M:'April weeks',N:'May weeks',O:'June weeks',P:'Total billing weeks',Q:'Partner broadcast allocation'};
const views={budgets:['Budgets',['C','Z','P','Q','R','T','U','V','W','AD','AE']],billing:['Monthly billing',['C','Z','AA','AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY','BA']],dates:['Campaign dates',['C','D','E','F','G','H','I','K','L','M']],shared:['Shared buy & trade',['C','O','P','Q','R','S','Z']],full:['Full source sheet',null]};
const variableViews={billing:['Billing weeks',['A','K','L','M','N','O','P']],dates:['Campaign dates',['A','E','F','G','H','I','J']],deadlines:['Proposal & approval dates',['A','B','C','D']],shared:['Shared buy allocation',['A','Q']]};
function isDate(a){const col=a.replace(/\d/g,'');return isVariables()?['B','C','D','E','F','H','I'].includes(col):['D','E','F','G','H','K','L','AH','AI','AJ','AK'].includes(col)||/\b[mdy]+[/\-][mdy]+/i.test(state.styles[cell(a).style]?.numberFormat||'');}
function format(a){const c=cell(a),v=c.value;if(v==null)return '';if(typeof v!=='number')return String(v);if(isDate(a))return dateLabel(v);if(isVariables())return a.startsWith('Q')?money(v):new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(v);const col=a.replace(/\d/g,'');if(['I','J','M','AQ','AS','AU','AW','AY'].includes(col))return String(v);return money(v);}
function raw(a){const c=cell(a);return c.formula||(isDate(a)?iso(c.input):String(c.input??''));}
function message(s){el('message').textContent=s;el('message').hidden=!s;}
function status(s,saved=true){el('save-status').textContent=s;el('save-status').classList.toggle('saved',saved);}
function preserve(){if(!dirty)return true;message('Save the variable or press Escape to discard this edit.');el('formula').focus();return false;}
function configure(){
 const variable=isVariables();el('page-title').textContent=variable?'Variables':'Markets';document.title='Weed Man '+(variable?'Variables':'Markets')+' | Final Fore';
 el('guide').textContent=variable?'2026 worksheet settings. New campaigns are managed in Campaign.':'Linked to EPIC3 · Dates and billing weeks in 2026 settings';
 el('markets-tab').setAttribute('aria-current','page');
 el('view').replaceChildren();Object.entries(variable?variableViews:views).forEach(([key,[label]])=>{const o=text('option',label);o.value=key;el('view').append(o);});
 el('market').replaceChildren(text('option','All markets'));el('market').firstChild.value='';state.rows.forEach(r=>{const o=text('option',r.name);o.value=r.row;el('market').append(o);});
 selected=variable?'L8':'Z8';el('save-cell').hidden=!variable;el('footer-tip').textContent=variable?'Double-click a yellow cell to edit':'Calculated amounts · select a cell to inspect its formula';
}
function render(){
 const variable=isVariables(),view=el('view').value,show=el('show-formulas').checked,market=Number(el('market').value),table=el('sheet');lastView=view;lastMarket=el('market').value;
 const spec=(variable?variableViews:views)[view][1];columns=spec||Array.from({length:state.layout.maxCol},(_,i)=>letters(i+1));
 visibleRows=view==='full'?Array.from({length:397},(_,i)=>i+4):view==='shared'?(variable?[48]:[48,49,50,51,55,116,119]):state.rows.map(r=>r.row);
 if(market)visibleRows=visibleRows.filter(r=>r===market||(view==='shared'&&market===48&&[49,50,51].includes(r))||(view==='shared'&&market===116&&r===119));
 if(!variable&&view!=='full'&&!market&&view!=='shared')visibleRows.push(329);
 const frozen=variable?'A':'C';if(view==='full'){columns=columns.filter(c=>c!==frozen);columns.unshift(frozen);}
 const sizes=columns.map(c=>c===frozen?null:show?230:c==='Z'||c==='AD'||c==='AE'||c==='BA'?125:variable&&c==='Q'?145:variable||['I','M','AQ','AS','AU','AW','AY'].includes(c)?92:112);
 table.className='markets-grid'+(show?' formulas-mode':'');table.style.width=`calc(var(--rownum) + var(--label) + ${sizes.reduce((s,v)=>s+(v||0),0)}px)`;table.replaceChildren();
 const cg=document.createElement('colgroup');[null,...sizes].forEach((width,i)=>{const c=document.createElement('col');c.style.width=i===0?'var(--rownum)':width?width+'px':'var(--label)';cg.append(c);});table.append(cg);
 const head=document.createElement('thead'),ltr=text('tr','','letters'),labels=text('tr','','labels');ltr.append(text('th','','rownum'));labels.append(text('th','','rownum'));
 for(const c of columns){const cls=c===frozen?'frozen-label':'';ltr.append(text('th',c,cls));const label=variable?variableHeaders[c]:(headers[c]||String(cell(c+'3').value||cell(c+'2').value||''));const th=text('th',label||c,cls);th.scope='col';labels.append(th);}head.append(ltr,labels);table.append(head);
 const warnings=new Set(state.issues.filter(i=>variable).map(i=>i.address));const body=document.createElement('tbody');
 for(const row of visibleRows){const tr=document.createElement('tr');tr.dataset.row=row;if(row===329)tr.className='summary';if([49,50,51,119].includes(row))tr.classList.add('detail');tr.append(text('th',row,'rownum'));
  for(const col of columns){const a=col+row,c=cell(a),td=text('td',row===329&&col===frozen?'2026 total':show&&c.formula?c.formula:format(a));td.dataset.address=a;td.id='cell-'+a;td.tabIndex=a===selected?0:-1;
   if(col===frozen)td.classList.add('frozen-label');if(typeof c.value==='string')td.classList.add('text');if(c.formula)td.classList.add('formula');if(state.links?.[a])td.classList.add('linked');if(editable(a))td.classList.add('variable');if(warnings.has(a))td.classList.add('warning');if(error(c.value))td.classList.add('error');if(a===selected)td.classList.add('selected');
   td.title=[a,format(a),c.formula,c.note].filter(Boolean).join('\n');td.setAttribute('aria-label',a+': '+format(a)+(editable(a)?' · editable variable':''));tr.append(td);
  }body.append(tr);
 }table.append(body);table.hidden=false;el('loading').hidden=true;
 if(!el('cell-'+selected))selected=columns[1]+(visibleRows[0]||8);select(selected);
 el('grand-total').textContent=money(state.totals.Z);el('counts').textContent=`${view==='full'?'400 source rows':visibleRows.filter(r=>r!==329).length+' rows'} · ${columns.length} columns`;
 renderIssues();
}
function select(a,focus=false){const node=el('cell-'+a);if(!node)return false;selected=a;document.querySelectorAll('td.selected').forEach(n=>{n.classList.remove('selected');n.tabIndex=-1;});node.classList.add('selected');node.tabIndex=0;
 const input=editable(a),c=cell(a);el('address').value=a;el('formula').type=input?.type==='date'?'date':'text';el('formula').value=raw(a);el('formula').readOnly=!input;el('save-cell').disabled=true;dirty=false;el('edit-formula').disabled=!c.formula;el('formula').setAttribute('aria-label',c.formula?'Calculated cell, read only':'Cell input value');
 el('cell-kind').textContent=`${a} · ${input?'Editable variable':c.formula?'Formula · '+format(a):'Source value'}`;
 let detail=c.formula?'Calculated cell, locked in the grid. Use Edit formula to change the calculation.':c.note||(!isVariables()?'Preserved source value.':'Calculated from the variables in this row.');
 const row=state.rows.find(r=>r.row===coords(a)[0]);if(isVariables()&&row?.dateReferenceRow&&['dates','deadlines'].includes(el('view').value)){const r=row.dateReferenceRow;detail+=` Dates_NM reference: ${dateLabel(state.dateReferences['B'+r]?.value)} to ${dateLabel(state.dateReferences['C'+r]?.value)}.`;}
 const issues=state.issues.filter(i=>isVariables()&&i.address===a);if(issues.length)detail=issues.map(i=>i.reason).join(' ')+' '+detail;
 el('cell-detail').textContent=detail;el('cell-detail').title=detail;
 const ref=c.formula?.match(/EPIC3!([A-Z]+[0-9]+)/);el('source-link').hidden=!ref;if(ref)el('source-link').href='/?cell='+ref[1];
 if(focus){node.focus({preventScroll:true});reveal(node);}return true;}
function reveal(node){const wrap=el('sheet-wrap'),n=node.getBoundingClientRect(),w=wrap.getBoundingClientRect(),frozen=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--label'))+parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rownum'));
 const header=el('sheet').tHead.getBoundingClientRect().height;
 if(n.top<w.top+header)wrap.scrollTop-=w.top+header-n.top;if(n.bottom>w.bottom-16)wrap.scrollTop+=n.bottom-w.bottom+16;if(!node.classList.contains('frozen-label')){if(n.left<w.left+frozen)wrap.scrollLeft-=w.left+frozen-n.left;if(n.right>w.right-16)wrap.scrollLeft+=n.right-w.right+16;}}
function goto(a){a=a.trim().replaceAll('$','').toUpperCase();const rc=coords(a);if(!rc||rc[0]>state.layout.maxRow||rc[1]>state.layout.maxCol){message('Choose a cell inside this worksheet.');return;}
 if(!isVariables()&&rc[0]<4){message('The full table displays source rows 4–400; column headings come from row 3.');return;}
 const col=letters(rc[1]);if(!columns.includes(col)||!visibleRows.includes(rc[0])){el('market').value='';if(!isVariables())el('view').value='full';else{const match=Object.entries(variableViews).find(([,v])=>v[1].includes(col));if(match)el('view').value=match[0];else return;}render();}
 if(!select(a,true))message('This cell is outside the active market orders.');else message('');}
async function load(config=false){if(busy)return;busy=true;try{const response=await fetch('/api/markets?sheet='+(isVariables()?'Variables':'Markets'));const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load workbook.');state=data;if(config)configure();render();status('Saved locally');}catch(e){message(e.message);status('Unable to load',false);}finally{busy=false;}}
async function save(){if(busy||!dirty||!editable(selected))return;busy=true;el('save-cell').disabled=true;el('formula').disabled=true;status('Saving…',false);message('');try{const response=await fetch('/api/variable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:selected,text:el('formula').value,revision:state.revision})});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to save variable.');state=data;dirty=false;render();status('Saved locally');}catch(e){message(e.message);status('Not saved',false);}finally{busy=false;el('formula').disabled=false;el('save-cell').disabled=!dirty;}}
function edit(){if(editable(selected)){el('formula').focus();if(el('formula').type!=='date')el('formula').select();}}
function renderIssues(){el('issues-button').textContent=`Review (${state.issues.length})`;el('issue-list').replaceChildren();for(const i of state.issues){const b=text('button','');b.type='button';b.append(text('strong',i.address),text('span',i.market+': '+i.reason));b.addEventListener('click',async()=>{if(!preserve())return;if(!isVariables()){location.hash='variables';await load(true);}goto(i.address);});el('issue-list').append(b);}}
el('sheet').addEventListener('click',e=>{const td=e.target.closest('td[data-address]');if(td&&!busy&&preserve()){select(td.dataset.address,true);message('');}});
el('sheet').addEventListener('dblclick',()=>{if(!busy)edit();});
el('sheet').addEventListener('keydown',e=>{if(busy)return;const rc=coords(selected),ci=columns.indexOf(letters(rc[1])),ri=visibleRows.indexOf(rc[0]);let row=rc[0],col=columns[ci];
 if(e.key==='ArrowDown')row=visibleRows[ri+1]??row;else if(e.key==='ArrowUp')row=visibleRows[ri-1]??row;else if(e.key==='ArrowRight'||e.key==='Tab'&&!e.shiftKey)col=columns[ci+1]??col;else if(e.key==='ArrowLeft'||e.key==='Tab'&&e.shiftKey)col=columns[ci-1]??col;else if(['Enter','F2'].includes(e.key)){e.preventDefault();edit();return;}else return;e.preventDefault();select(col+row,true);});
el('formula').addEventListener('input',()=>{if(!editable(selected))return;dirty=el('formula').value!==raw(selected);el('save-cell').disabled=!dirty;status(dirty?'Unsaved variable':'Saved locally',!dirty);});
el('formula').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){select(selected,true);message('');status('Saved locally');}});
el('save-cell').addEventListener('click',save);el('address').addEventListener('keydown',e=>{if(e.key==='Enter'&&preserve())goto(el('address').value);});
for(const id of ['view','market','show-formulas'])el(id).addEventListener('change',()=>{if(!preserve()||busy){el('view').value=lastView;el('market').value=lastMarket;return;}message('');render();el('sheet-wrap').scrollTo(0,0);});
el('refresh').addEventListener('click',()=>{if(preserve())load();});
for(const name of ['issues','help']){el(name+'-button').addEventListener('click',()=>{el(name).hidden=!el(name).hidden;el(name+'-button').setAttribute('aria-expanded',String(!el(name).hidden));});el('close-'+name).addEventListener('click',()=>{el(name).hidden=true;el(name+'-button').setAttribute('aria-expanded','false');});}
window.addEventListener('beforeunload',e=>{if(dirty||el('formula-dialog').open){e.preventDefault();e.returnValue='';}});
for(const id of ['markets-tab','legacy-variables'])el(id).addEventListener('click',async e=>{e.preventDefault();if(!preserve()||busy)return;history.replaceState(null,'',id==='legacy-variables'?'/markets.html#variables':'/markets.html');await load(true);el('sheet-wrap').scrollTo(0,0);});
window.addEventListener('hashchange',()=>{if(!dirty&&!busy&&!el('formula-dialog').open)load(true);});
window.addEventListener('focus',()=>{if(!dirty&&!busy&&state&&!el('formula-dialog').open)load();});
load(true);

el('edit-formula').addEventListener('click',()=>{if(busy||!preserve()||!cell(selected).formula)return;el('formula-context').textContent=state.sheet+' '+selected+' · Current result: '+format(selected);el('formula-expression').value=cell(selected).formula;el('formula-error').hidden=true;el('formula-dialog').showModal();el('formula-expression').focus();});
el('cancel-formula').addEventListener('click',()=>{if(!busy)el('formula-dialog').close();});
el('formula-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
el('formula-editor').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;el('save-formula').disabled=true;el('cancel-formula').disabled=true;el('formula-error').hidden=true;try{const response=await fetch('/api/formula',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheet:state.sheet,address:selected,text:el('formula-expression').value,revision:state.revision})});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to save formula.');state=data;el('formula-dialog').close();render();status('Formula saved locally');}catch(error){el('formula-error').textContent=error.message;el('formula-error').hidden=false;}finally{busy=false;el('save-formula').disabled=false;el('cancel-formula').disabled=false;}});
