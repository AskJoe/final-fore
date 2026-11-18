import { AccessError } from '@/lib/access';
import { loadWorkbookPage } from '@/lib/broadcast/store';
import { isSheetName } from '@/lib/broadcast/workbook';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get('sheet') ?? '';
  if (!isSheetName(name)) return new Response('Unknown sheet', { status: 400 });
  const get = (key: string) => params.get(key) ?? '';
  try {
    const result = await loadWorkbookPage(name, {
      filters: { market: get('market'), rep: get('rep'), client: get('client'), firm: get('firm') },
      grouping: { primary: get('primary'), secondary: get('secondary') }, page: Number(get('page')),
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return new Response('Unable to load research.', { status: error instanceof AccessError ? error.status : 503 });
  }
}
