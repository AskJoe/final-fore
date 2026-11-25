import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { StorageError } from '../store';
import { orderPdfMarkup, type PrintOrder } from './print-markup';

export { orderPdfMarkup } from './print-markup';

export const ORDER_PDF_VERSION = 'ffm-media-order-v4';

let rendering = false;
export async function renderOrderPdf(doc: PrintOrder, markets: Readonly<Record<string, string>>, clientOrder = false) {
  if (rendering) throw new StorageError('Another order PDF is being prepared. Try again shortly.');
  rendering = true;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const logo = await readFile(path.join(process.cwd(), 'public/brand/media-order-logo.png'));
    browser = await chromium.launch({ headless: true, timeout: 15_000 });
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', route => route.abort());
    await page.setContent(orderPdfMarkup(doc, 'data:image/png;base64,' + logo.toString('base64'), markets, false, clientOrder), { timeout: 12_000 });
    const controller = new AbortController();
    try {
      return await Promise.race([
        page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true }),
        delay(20_000, undefined, { signal:controller.signal, ref:false }).then(() => {
          throw new Error('PDF render timed out.');
        }),
      ]);
    } finally {
      controller.abort();
    }
  } catch {
    throw new StorageError('The finalized PDF could not be prepared. Your saved order is available to retry.');
  } finally {
    await browser?.close().catch(() => undefined);
    rendering = false;
  }
}
