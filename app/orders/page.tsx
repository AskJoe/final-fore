import { redirect } from 'next/navigation';
import { AccessError, requireMember } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import { ordersPilot } from '@/lib/orders/access';
import AppSidebar from '@/app/research/_components/AppSidebar';
import OrdersWorkspace from './OrdersWorkspace';
import '@/app/research/research.css';
import './orders.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders | Final Fore Media' };

export default async function OrdersPage({searchParams}: {
  searchParams: Promise<{ id?: string; clientId?: string }>;
}) {
  let user;
  try { ({user} = await requireMember()); }
  catch (error) { if (error instanceof AccessError) redirect(loginPath(error)); throw error; }
  if (!ordersPilot(user)) redirect('/orders.html');
  const {id, clientId} = await searchParams;
  return <><AppSidebar current="orders" ordersPilot/><div className="research-app">
    <main className="research-main"><OrdersWorkspace initialOrderId={typeof id === 'string' ? id : undefined} initialClientId={typeof clientId === 'string' ? clientId : undefined}/></main>
  </div></>;
}
