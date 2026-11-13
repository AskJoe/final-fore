import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import { InputError } from '../domain/types';
import { FILE_TYPES, MAX_FILE_SIZE, type UploadInput } from './portals';

const CHUNK_SIZE = 64 * 1024;
const MACRO_MARKERS = [Buffer.from('vbaProject.bin'), Buffer.from('_VBA_PROJECT'), Buffer.from('_VBA_PROJECT', 'utf16le')];

/** Hash and inspect all bytes with backpressure; format detection reads a private temporary file. */
export async function validateStreamedDocument(
  stream: ReadableStream<Uint8Array>,
  metadata: Omit<UploadInput, 'marketId'>,
  signal: AbortSignal = AbortSignal.timeout(20000),
): Promise<void> {
  let directory: string | undefined;
  let source: Readable | undefined;
  try {
    const extension = metadata.name.split('.').pop()!.toLowerCase();
    if (!FILE_TYPES[extension] || FILE_TYPES[extension] !== metadata.contentType) throw new InputError('This file format is not allowed.');
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > MAX_FILE_SIZE) throw new InputError('Uploaded file size does not match.');
    const isText = ['txt', 'csv'].includes(extension);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const hash = createHash('sha256');
    let size = 0, textTail = '', byteTail: Buffer = Buffer.alloc(0);
    const inspectText = (text: string, final = false) => {
      // Collapse whitespace before retaining the suffix, so tags split by arbitrarily
      // long whitespace or a chunk boundary cannot evade the existing HTML check.
      const window = (textTail + text + (final ? '\n' : '')).replace(/\s+/g, ' ');
      if (window.includes('\0') || /<\s*(?:html|script|svg|!doctype\s+html)(?=\W)/i.test(window)) throw new InputError('This file format is not allowed.');
      textTail = window.slice(-64);
    };
    directory = await mkdtemp(join(tmpdir(), 'final-fore-verify-'));
    const filename = join(directory, 'document');
    const inspect = new Transform({
      highWaterMark: CHUNK_SIZE,
      transform(chunk: Buffer, _encoding, callback) {
        try {
          size += chunk.length;
          if (size > metadata.size || size > MAX_FILE_SIZE) throw new InputError('Uploaded file size does not match.');
          hash.update(chunk);
          for (let offset = 0; offset < chunk.length; offset += CHUNK_SIZE) {
            const part = chunk.subarray(offset, offset + CHUNK_SIZE);
            if (isText) {
              let text: string;
              try { text = decoder.decode(part, { stream: true }); }
              catch { throw new InputError('The file contents could not be read.'); }
              inspectText(text);
            }
            else {
              const window = Buffer.concat([byteTail, part]);
              if (MACRO_MARKERS.some(marker => window.includes(marker))) throw new InputError('Macro-enabled documents are not supported.');
              byteTail = Buffer.from(window.subarray(-64));
            }
          }
          callback(null, chunk);
        } catch (error) { callback(error as Error); }
      },
    });
    // Attach pipeline error handling immediately after adapting the network stream.
    source = Readable.fromWeb(stream as import('node:stream/web').ReadableStream<Uint8Array>, { highWaterMark: CHUNK_SIZE });
    await pipeline(source, inspect, createWriteStream(filename, { flags: 'wx', mode: 0o600, highWaterMark: CHUNK_SIZE }), { signal });
    if (size !== metadata.size) throw new InputError('Uploaded file size does not match.');
    if (hash.digest('hex') !== metadata.sha256) throw new InputError('Uploaded file hash does not match. Choose the file again.');
    if (isText) {
      let text: string;
      try { text = decoder.decode(); }
      catch { throw new InputError('The file contents could not be read.'); }
      inspectText(text, true);
    }
    else {
      const type = await fileTypeFromFile(filename, { signal, maxBufferSize: 1024 * 1024 });
      const legacy = ['xls', 'doc', 'ppt'].includes(extension) && type?.ext === 'cfb';
      if (!legacy && type?.mime !== metadata.contentType) throw new InputError('The file format does not match its extension.');
    }
  } finally {
    if (source) source.destroy();
    else await stream.cancel().catch(() => {});
    // Only this invocation's private scratch directory; never Supabase objects or user files.
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
