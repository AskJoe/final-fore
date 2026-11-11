import { researchStorageError } from './queue-store';
type ReadQuery<T>={range(from:number,to:number):PromiseLike<{data:T[]|null;error:{code?:string;message:string}|null}>};
/** Explicit paging avoids Supabase's default row cap silently truncating a conversation or file list. */
export async function readAll<T>(query:ReadQuery<T>):Promise<{data:T[];error:null}>{
  const rows:T[]=[];
  for(let offset=0;;offset+=500){const {data,error}=await query.range(offset,offset+499);if(error)researchStorageError(error);rows.push(...data??[]);if(!data||data.length<500)return {data:rows,error:null};}
}
