import { redirect } from 'next/navigation';
import { AccessError, requireMember } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import AppSidebar from '@/app/research/_components/AppSidebar';
import OrdersWorkspace from '@/app/orders/OrdersWorkspace';
import '@/app/research/research.css';
import '@/app/orders/orders.css';

export type CampaignSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CampaignOrdersPage({ searchParams, calendar }: {
  searchParams: CampaignSearchParams; calendar: boolean;
}) {
  try { await requireMember(); }
  catch (error) { if (error instanceof AccessError) redirect(loginPath(error)); throw error; }
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] : undefined;
  const year = Number(value('year'));
  const campaignId = value('campaignId');
  const initialWorkflow = value('workflow') === 'digital' ? 'digital' : 'broadcast';
  const plan = new URLSearchParams();
  if (value('workflow')) plan.set('workflow', initialWorkflow);
  if (campaignId) plan.set('id', campaignId);
  return <><AppSidebar current="campaign"/><div className="research-app">
    <main className="research-main campaign-calendar-main">
      <OrdersWorkspace planUrl={'/campaign.html' + (plan.size ? '?' + plan : '')} campaignId={campaignId}
        initialOrderId={value('id')} initialClientId={value('clientId')}
        initialYear={Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined}
        initialMarketId={value('marketId')} initialWorkflow={initialWorkflow}
        view={calendar ? 'calendar' : value('view') === 'historical' ? 'historical' : 'orders'} />
    </main>
  </div></>;
}
