import { AccessError } from '@/lib/access';
import { loginPath } from '@/lib/login-errors';
import { loadWorkbookPage } from '@/lib/broadcast/store';
import { defaultQuery } from '@/lib/broadcast/view';
import { isSheetName } from '@/lib/broadcast/workbook';
import { redirect } from 'next/navigation';
import BroadcastWorkbook from './BroadcastWorkbook';
import './broadcast.css';

export const metadata = { title: 'Broadcast Research | Final Fore Media' };

export default async function BroadcastResearch({ searchParams }: { searchParams: Promise<{ sheet?: string | string[] }> }) {
  const requested = (await searchParams).sheet;
  const name = typeof requested === 'string' && isSheetName(requested) ? requested : 'tv';
  let data: Awaited<ReturnType<typeof loadWorkbookPage>>;
  try {
    data = await loadWorkbookPage(name, defaultQuery);
  } catch (error) {
    if (error instanceof AccessError) redirect(loginPath(error));
    return <section className="broadcast-unavailable"><h1>Broadcast Research</h1><p role="alert">Unable to load research. Try reloading the page.</p></section>;
  }
  return <BroadcastWorkbook key={name} name={name} initialView={data.view} reviews={data.reviews} />;
}
