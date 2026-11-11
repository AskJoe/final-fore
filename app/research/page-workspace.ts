import { redirect } from 'next/navigation';
import { AccessError } from '@/lib/access';
import { loadResearchWorkspace } from '@/lib/research/workspace';
export async function researchPageWorkspace(){
  try{return (await loadResearchWorkspace()).workspace;}catch(e){
    if(e instanceof AccessError)redirect('/login'+(e.status===401?'':'?error='+encodeURIComponent(e.message)));
    throw e;
  }
}
