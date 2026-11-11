import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessError, requireMember } from '@/lib/access';
import AppSidebar from './_components/AppSidebar';
import './research.css';
export const dynamic='force-dynamic';
export default async function ResearchLayout({children}:{children:React.ReactNode}){
  try{await requireMember();}catch(e){if(e instanceof AccessError)redirect('/login'+(e.status===401?'':'?error='+encodeURIComponent(e.message)));throw e;}
  return <><AppSidebar/><div className="research-app"><nav className="research-nav" aria-label="Research"><Link href="/research/new">Reps &amp; email</Link><Link href="/research/templates">Templates</Link><Link href="/research">Inbox</Link><Link href="/research/files">Incoming files</Link></nav><main className="research-main">{children}</main></div></>;
}
