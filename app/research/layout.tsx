import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessError, requireMember } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import { ordersPilot } from '@/lib/orders/access';
import AppSidebar from './_components/AppSidebar';
import './research.css';
export const dynamic='force-dynamic';
export default async function ResearchLayout({children}:{children:React.ReactNode}){
  let pilot=false;
  try{pilot=ordersPilot((await requireMember()).user);}catch(e){if(e instanceof AccessError)redirect(loginPath(e));throw e;}
  return <><AppSidebar ordersPilot={pilot}/><div className="research-app"><nav className="research-nav" aria-label="Research"><Link href="/research/new">Reps &amp; email</Link><Link href="/research/templates">Templates</Link><Link href="/research">Inbox</Link><Link href="/research/files">Incoming files</Link><Link href="/research/broadcast" prefetch={false}>Broadcast Research</Link></nav><main className="research-main">{children}</main></div></>;
}
