import { validOrderDate } from './dates';
export type EditorValueType='text'|'date'|'money'|'number'|'decimal'|'multiline';
export function parseEditorValue(raw:string,type:EditorValueType,max?:number):
  {valid:true;value:string|number|null}|{valid:false} {
  if(type==='text'||type==='multiline')return {valid:true,value:raw};
  if(type==='date')return raw===''||validOrderDate(raw)?{valid:true,value:raw}:{valid:false};
  if(raw==='')return {valid:true,value:null};
  const pattern=type==='number'?/^\d+$/:type==='money'?/^\d+(?:\.\d{1,2})?$/:/^\d+(?:\.\d+)?$/;
  if(!pattern.test(raw))return {valid:false};
  const number=Number(raw);
  const value=type==='money'?Math.round(number*100):number;
  if(!Number.isFinite(number)||number<0||max!==undefined&&number>max||
    type!=='decimal'&&!Number.isSafeInteger(value))return {valid:false};
  return {valid:true,value};
}
