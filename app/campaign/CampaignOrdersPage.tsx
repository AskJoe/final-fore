import { redirect } from 'next/navigation';
import { AccessError, requireMember } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import { campaignPlanUrl, resolveCampaignRoute } from '@/lib/campaign-routes';
import { SupabaseStore } from '@/lib/store';
import AppSidebar from '@/app/research/_components/AppSidebar';
import OrdersWorkspace from '@/app/orders/OrdersWorkspace';
import '@/app/research/research.css';
import '@/app/orders/orders.css';

export type CampaignSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CampaignOrdersPage({ searchParams, calendar }: {
  searchParams: CampaignSearchParams; calendar: boolean;
}) {
  const { supabase } = await requireMember().catch(error => {
    if (error instanceof AccessError) redirect(loginPath(error));
    throw error;
  });
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] : undefined;
  const year = Number(value('year'));
  const campaignId = value('campaignId');
  const campaign = campaignId ? await resolveCampaignRoute(new SupabaseStore(supabase), campaignId) : null;
  const legacyWorkflow = value('workflow') === 'digital' || Array.isArray(params.workflow) && params.workflow.includes('digital');
  if (legacyWorkflow || campaign?.legacy) {
    const canonical = new URLSearchParams({workflow:'broadcast'});
    const clientId = value('clientId') || campaign?.clientId;
    const planningYear = value('year') || (campaign ? String(campaign.year) : undefined);
    if (clientId) canonical.set('clientId', clientId);
    if (planningYear) canonical.set('year', planningYear);
    if (campaign?.id && clientId === campaign.clientId && Number(planningYear) === campaign.year) {
      canonical.set('campaignId', campaign.id);
    }
    for (const key of ['id', 'marketId', 'view']) {
      const field = value(key);
      if (field) canonical.set(key, field);
    }
    if (!calendar) canonical.set('section', value('section') === 'broadcast' ? 'broadcast' : 'digital');
    redirect('/campaign/' + (calendar ? 'calendar?' : 'orders?') + canonical);
  }
  const initialSection = value('section') === 'digital' ? 'digital' : 'broadcast';
  return <><AppSidebar current="campaign"/><div className="research-app">
    <main className="research-main campaign-calendar-main">
      <OrdersWorkspace planUrl={campaignPlanUrl(campaignId)} campaignId={campaignId}
        initialOrderId={value('id')} initialClientId={value('clientId')}
        initialYear={Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined}
        initialMarketId={value('marketId')} initialSection={initialSection}
        view={calendar ? 'calendar' : value('view') === 'historical' ? 'historical' : 'orders'} />
    </main>
  </div></>;
}
