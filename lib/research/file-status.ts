/** Honor explicit processing deadlines without treating time in the queue as a failed file. */
export function uploadStatus<S extends string>(file:{state:S;error:string|null;check_deadline?:string|null;updated_at?:string},now=Date.now()):{state:S|'failed';error:string|null}{
 // Queue age is not a verification timeout. Only an explicit processing deadline can expire.
 const deadline=file.check_deadline?Date.parse(file.check_deadline):Infinity;
 if(file.state==='checking'&&deadline<=now)return {state:'failed',error:'Upload verification timed out. Please upload this file again.'};
 return {state:file.state,error:file.error};
}
