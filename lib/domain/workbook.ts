import { Calculator, colName, coordinates, parse, references } from './formulas';
import { check, Conflict, finite, day, type Workbook, type Data, type Cell } from './types';
export const MAPPING: Record<number, string> = {5:'IO',8:'DP',22:'DA',35:'CL',48:'BW',55:'BW',71:'KW',84:'EE',87:'EK',101:'AS',116:'AD',133:'O',146:'IC',159:'HT',172:'GG',185:'FR',198:'GV',211:'FC',224:'HK',237:'BH',250:'II',263:'JA',266:'JG',269:'JP',278:'IR',281:'JS'};
// Preserve the original row ordering (which differs from JavaScript's numeric key ordering).
export const PRIMARY = [5,8,22,35,48,55,71,84,87,101,116,133,146,159,172,185,198,211,224,237,250,263,266,269,278,281,287,290];
export const ACTIVE = [...new Set(PRIMARY.map(r => MAPPING[r]).filter(Boolean))];
export const EPOCH = Date.UTC(1899, 11, 30);
export function serialDate(value: any) { return finite(value) && value > 0 && value < 73051 ? new Date(EPOCH + Math.trunc(value) * 86400000).toISOString().slice(0,10) : ''; }
const CHANNEL_ROWS = [3,4,5, ...Array.from({length:13},(_,i)=>i+8), ...Array.from({length:6},(_,i)=>i+22),30,40,44,48];
const RATE_ROWS = [3,8,10,11,12,13,14,15,16,17,19,22,23,24,25,30,40,44,48,6,26,27,41,45,49];
const MANUAL_ROWS = [4,5,9,18,20,26,27];
export function policy(w: Workbook) {
  if (!w.metadata.planning_columns) return null;
  const cells = w.sheets.EPIC3, editable = new Set<string>(), targets = new Set<string>();
  const isInput = (a: string) => !cells[a]?.formula;
  for (const row of RATE_ROWS) if (isInput('B'+row)) editable.add('B'+row);
  for (const p of w.periods) {
    const [spend, share, imps] = [0,1,2].map(n => colName(p.start_column+n));
    for (let r = 3; r <= 55; r++) {
      for (const col of [spend,share,imps]) targets.add(col+r);
      if ([...CHANNEL_ROWS,33,36].includes(r) && isInput(spend+r)) editable.add(spend+r);
      const a = imps+r;
      if (isInput(a) && (MANUAL_ROWS.includes(r) || p.year<2026 && CHANNEL_ROWS.includes(r) || cells[a]?.input != null)) editable.add(a);
    }
  }
  return {version:1, editableInputs:[...editable].sort(), formulaTargets:[...targets].sort(), addedFormulas:w.metadata.planning_columns.addedFormulas, formulaScope:'2026'};
}
function reviewIssues(w: Workbook) {
  const markets=w.sheets.Markets, variables=w.sheets.Variables, issues: Data[]=[];
  for (const row of PRIMARY) {
    const name=markets['C'+row].value, value=(c:string)=>variables[c+row]?.value;
    const flag=(c:string,reason:string)=>issues.push({sheet:'Variables',address:c+row,market:name,reason});
    for (const [start,end] of [['E','F'],['H','I']]) {
      const s=value(start), e=value(end);
      for (const c of [start,end]) if (finite(value(c)) && new Date(EPOCH+value(c)*86400000).getUTCFullYear()!==2026) flag(c,'Campaign date is outside 2026. Confirm before using this schedule.');
      if (finite(s)&&finite(e)&&e<s) flag(end,'End date is before its start date.');
    }
    const starts=['E','H'].map(value).filter(finite);
    for (const c of ['B','D']) if (starts.length && finite(value(c)) && value(c)>Math.min(...starts)) flag(c,'Proposal goal or approval falls after the campaign starts. Confirm this source date.');
    if (!finite(value('P')) || value('P')<=0) flag('K','At least one billing month needs a positive number of weeks.');
  }
  if (finite(markets.S48.value) && variables.Q48.value>markets.S48.value) issues.push({sheet:'Variables',address:'Q48',market:'Denver',reason:'Partner allocation exceeds the current broadcast buy.'});
  return issues;
}
export function snapshot(w: Workbook, name='EPIC3'): Data {
  if (name==='EPIC3') return {cells:w.sheets.EPIC3,planning:policy(w),styles:w.styles,periods:w.periods,layout:w.metadata.layout,source:w.metadata.source,revision:w.metadata.revision};
  check(['Markets','Variables'].includes(name),'Unknown worksheet.');
  return {sheet:name,cells:w.sheets[name],styles:w.styles,layout:w.metadata[name==='Markets'?'markets_layout':'variables_layout'],rows:w.metadata.markets_rows,source:w.metadata.markets_source,revision:w.metadata.revision,
    editable:name==='Variables'?Object.fromEntries(Object.entries(w.metadata.variable_inputs).filter(([a])=>!w.sheets.Variables[a]?.formula)):{},links:name==='Markets'?w.links:{},issues:reviewIssues(w),dateReferences:w.sheets.Dates_NM,
    totals:Object.fromEntries(['Z','AP','AR','AT','AV','AX','BA'].map(c=>[c,w.sheets.Markets[c+'329'].value]))};
}
export function recalculate(w: Workbook) {
  const calc=new Calculator(w.sheets);
  const values: [Cell, any][]=[];
  for (const [s,cells] of Object.entries(w.sheets)) for (const [a,c] of Object.entries(cells)) values.push([c,calc.cell(s,a)]);
  check(!values.some(([,v])=>v==='#CYCLE!'),'This formula creates a circular reference. The change was not saved.');
  for (const [c,v] of values) c.value=v;
}
export function edit(w: Workbook, kind: 'cell'|'formula'|'variable', payload: Data): Data {
  const {address,text,revision}=payload, sheet=kind==='variable'?'Variables':payload.sheet??'EPIC3';
  check(['EPIC3','Markets','Variables'].includes(sheet),'Unknown worksheet.');
  check(typeof address==='string','Choose a valid cell address.');
  check(typeof text==='string'&&text.length<=(kind==='variable'?100:2000),'Invalid cell entry.');
  if (revision!==w.metadata.revision) throw new Conflict('This workbook changed in another window. Reload before saving.');
  let current=w.sheets[sheet][address], value: any=null, formula: string|null=null;
  const rules=policy(w), now=new Date().toISOString();
  if (kind==='variable') {
    const definition=w.metadata.variable_inputs[address]; check(definition,'Choose an editable variable.');
    check(!current?.formula,'This is a calculated cell. Use Edit formula to change its formula.');
    if (text.trim()) {
      if (definition.type==='date') { value=(Date.parse(day(text.trim(),'Date')+'T00:00:00Z')-EPOCH)/86400000; check(value>=1&&value<=73050,'Use a date between 1900 and 2099.'); }
      else { const raw=text.trim().replaceAll(',','').replaceAll('$',''); check(raw.length>0,'Enter a finite, nonnegative number.'); value=Number(raw); check(finite(value)&&value>=0,'Enter a finite, nonnegative number.'); check(definition.type!=='weeks'||value<=53,'Weeks must be between 0 and 53.'); }
    }
    if (definition.type==='allocation'&&value===null) value=0;
    const before=current.input; current.input=value; recalculate(w);
    check(w.sheets.Variables['P'+definition.row].value>0,'Keep at least one positive billing week so payments can be calculated.');
    if (definition.type==='allocation') check(finite(w.sheets.Markets.S48.value)&&value<=w.sheets.Markets.S48.value,'Partner allocation cannot exceed the current Denver broadcast buy.');
    w.variableChanges.push({id:(w.variableChanges.at(-1)?.id??0)+1,changed_at:now,address,old_input:JSON.stringify(before),new_input:JSON.stringify(value)});
  } else {
    if (kind==='cell') {
      check(sheet==='EPIC3','Unknown worksheet.');
      check(!current?.formula,'This is a calculated cell. Use Edit formula to change its formula.');
      check(!rules||rules.editableInputs.includes(address),'This is a calculated cell or a non-input field. Use a yellow input column; use Edit formula for calculations.');
      check(!text.trim().startsWith('='),'Input cells accept values only. Formulas are managed in the separate formula editor.');
    } else {
      check(current?.formula || sheet==='EPIC3'&&rules?.formulaTargets.includes(address),'Select an existing calculated cell to edit its formula.');
      check(text.trim().startsWith('='),'Enter a formula beginning with =. Calculated cells cannot be replaced with plain values.'); formula=text.trim();
    }
    if (sheet==='EPIC3') {
      const [row,col]=coordinates(address); check(row>2&&col!==1,'The source headers and row labels are read only.'); check(row<=w.metadata.layout.maxRow&&col<=w.metadata.layout.maxCol,'Choose a cell inside the imported table.');
    }
    if (formula) {
      const tree=parse(formula);
      for (const [s,a] of references(tree,sheet)) {
        const [r,c]=coordinates(a);
        if (sheet==='EPIC3') check(s==='EPIC3'?r<=w.metadata.layout.maxRow&&c<=w.metadata.layout.maxCol:!!w.sheets[s]?.[a],'That reference is outside the imported table or dependency cells.');
        else if (!w.sheets[s]?.[a]) { const key=({EPIC3:'layout',Markets:'markets_layout',Variables:'variables_layout'} as Data)[s]; check(key&&r<=w.metadata[key].maxRow&&c<=w.metadata[key].maxCol,'That reference is outside the imported table.'); }
      }
    } else if (text!=='') {
      value=text; const cleaned=text.trim().replaceAll(',','').replaceAll('$','');
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?%?$/.test(cleaned)) { value=Number(cleaned.replace(/%$/,''))/(cleaned.endsWith('%')?100:1); check(finite(value),'Enter a finite number.'); }
    }
    const old={input:current?.input??null,formula:current?.formula??null};
    if (old.input===value&&old.formula===formula) return snapshot(w,sheet);
    if (!current) { current={input:null,formula:null,value:null,sourceInput:null,sourceFormula:null,sourceValue:null,style:w.metadata.layout.styles[address]??0,note:''}; w.sheets[sheet][address]=current; }
    current.input=value; current.formula=formula; recalculate(w);
    w.changes.push({id:(w.changes.at(-1)?.id??0)+1,changed_at:now,address:sheet==='EPIC3'?address:sheet+'!'+address,old_input:JSON.stringify(old.input),old_formula:old.formula,new_input:JSON.stringify(value),new_formula:formula});
  }
  w.metadata.revision++; return snapshot(w,sheet);
}
