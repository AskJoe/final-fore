import { redirect } from 'next/navigation';
import { AccessError } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import { loadResearchWorkspace } from '@/lib/research/workspace';
export async function researchPageWorkspace(){
  try{return (await loadResearchWorkspace()).workspace;}catch(e){
    if(e instanceof AccessError)redirect(loginPath(e));
    throw e;
  }
}
