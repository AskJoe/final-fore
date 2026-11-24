import type { OrderDocument,OrderLine,OrderSourceFact } from '../orders/store';
import type { ResearchRow } from '../orders/sources';
function eligibleFact(fact:OrderSourceFact,line:OrderLine) {
  if(fact.label==='Source content hashes')return false;
  if(!/^Original file \d+$/.test(fact.label))return true;
  try{
    const file=JSON.parse(String(fact.value));
    return file.marketId===line.marketId || (!file.marketId&&file.id===line.source?.id);
  }catch{return false;}
}
export function projectLine(line:OrderLine):OrderLine {
  return {...line,source:line.source?{...line.source,facts:line.source.facts?.filter(fact=>eligibleFact(fact,line))}:undefined};
}
export function projectDocument(document:OrderDocument):OrderDocument {
  return {...document,lines:document.lines.map(projectLine)};
}
export function projectRow(row:ResearchRow,columns:{label:string}[]=[]){
  return {id:row.id,marketId:row.marketId,market:row.market,program:row.program,firm:row.firm,rep:row.rep,
    source:row.source,line:row.line?projectLine(row.line):null,
    periods:row.periods?.map(period=>({...period,line:projectLine(period.line)})),
    facts:columns.map((column,index)=>({label:column.label,value:row.cells[index]??null}))};
}
export function projectResearchPage(page:{rows:ResearchRow[];columns:{label:string}[];total:number;page:number;pageCount:number}){
  return {rows:page.rows.map(row=>projectRow(row,page.columns)),total:page.total,page:page.page,pageCount:page.pageCount};
}
