import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { StorageError } from '../store';
import { MAX_FILE_SIZE } from './portals';

const execute = promisify(execFile);
const maxPdfSize = 32 * 1024 * 1024;
const maxConcurrentRenders = 2;
let activeRenders = 0;

// This profile is new for each conversion and never loads user settings, macros or updates to linked data.
const previewProfile = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Calc/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>1</value></prop>
  </item>
</oor:items>`;

export async function renderWorkbookPreview(url: string, name: string, requestSignal: AbortSignal) {
  if (activeRenders >= maxConcurrentRenders) throw new StorageError('The preview is busy. Try again in a moment.');
  activeRenders++;
  let directory: string | undefined;

  try {
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(30_000)]);
    directory = await mkdtemp(join(tmpdir(), 'final-fore-excel-preview-'));
    const profile = join(directory, 'profile');
    await mkdir(join(profile, 'user'), { recursive: true });
    await writeFile(join(profile, 'user', 'registrymodifications.xcu'), previewProfile);
    const legacy = name.toLowerCase().endsWith('.xls');
    const workbook = join(directory, legacy ? 'workbook.xls' : 'workbook.xlsx');
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('Storage fetch failed.');
    let size = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_FILE_SIZE) callback(new Error('Workbook is too large.'));
      else callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
      limit, createWriteStream(workbook, { mode: 0o600 }), { signal });

    await execute(process.env.FINAL_FORE_SOFFICE_PATH || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless', '--norestore', '--nodefault',
      `--infilter=${legacy ? 'MS Excel 97' : 'Calc MS Excel 2007 XML'}`,
      '--convert-to', 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}',
      '--outdir', directory, workbook,
    ], {
      signal, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LANG: process.env.LANG, NODE_ENV: 'production' },
    });
    const output = join(directory, 'workbook.pdf');
    const { size: outputSize } = await stat(output);
    if (outputSize < 5 || outputSize > maxPdfSize) throw new Error('Preview is empty or too large.');
    const pdf = await readFile(output, { signal });
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF preview.');
    return pdf;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (error as NodeJS.ErrnoException).syscall?.startsWith('spawn')) {
      console.error('Excel previews need LibreOffice Calc on the app server.');
      throw new StorageError('Excel preview is unavailable on this server. You can download the original.');
    }
    throw new StorageError('Could not open this workbook preview. You can download the original.');
  } finally {
    activeRenders--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
