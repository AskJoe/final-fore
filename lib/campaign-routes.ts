import { campaignKey, Service } from './service';
import type { Store } from './store';

type CampaignSummary = { id: string; name: string; clientId: string; year: number; workflow: string };
type CampaignRoute = Pick<CampaignSummary, 'clientId' | 'year'> & { id?: string; legacy: boolean };

export const campaignPlanUrl = (id?: string) => '/campaign.html?' +
  new URLSearchParams(id ? { workflow: 'broadcast', id } : { workflow: 'broadcast' });

export async function resolveCampaignRoute(store: Store, id: string): Promise<CampaignRoute | null> {
  const record = id ? await store.get(campaignKey(id)) : null;
  if (!record) return null;
  const { name, year, workflow } = record.payload;
  const clientId = record.payload.clientId === 'weed-man' ? 'epic3' : record.payload.clientId;
  if (workflow === 'broadcast') return { id, clientId, year, legacy: false };

  const { campaigns } = await new Service(store).get('campaigns', new URLSearchParams()) as { campaigns: CampaignSummary[] };
  const active = campaigns.filter(campaign =>
    campaign.workflow === 'broadcast' && campaign.clientId === clientId && campaign.year === year);
  const matching = active.find(campaign =>
    campaign.name.trim().toLowerCase() === name.trim().toLowerCase());
  const replacement = matching ?? (active.length === 1 ? active[0] : undefined);
  return { id: replacement?.id, clientId, year, legacy: true };
}
