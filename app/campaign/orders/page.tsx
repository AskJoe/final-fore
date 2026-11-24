import CampaignOrdersPage, { type CampaignSearchParams } from '../CampaignOrdersPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign Orders | Final Fore Media' };

export default function OrdersPage({ searchParams }: { searchParams: CampaignSearchParams }) {
  return <CampaignOrdersPage searchParams={searchParams} calendar={false} />;
}
