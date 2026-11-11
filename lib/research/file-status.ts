/** A dead worker or disconnected browser must not leave an indefinite Checking label. */
export function uploadStatus<S extends string>(file:{state:S;error:string|null;check_deadline?:string|null;updated_at?:string},now=Date.now()):{state:S|'failed';error:string|null}{
 const deadline=file.check_deadline?Date.parse(file.check_deadline):file.updated_at?Date.parse(file.updated_at)+600000:Infinity;
 if(file.state==='checking'&&deadline<=now)return {state:'failed',error:'Upload verification timed out. Please upload this file again.'};
 return {state:file.state,error:file.error};
}
