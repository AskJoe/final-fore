import CampaignOrdersPage, { type CampaignSearchParams } from '../CampaignOrdersPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Campaign Calendar | Final Fore Media' };

export default function CampaignCalendarPage({ searchParams }: { searchParams: CampaignSearchParams }) {
  return <CampaignOrdersPage searchParams={searchParams} calendar />;
}
