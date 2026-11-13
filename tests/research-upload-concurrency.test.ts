import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateStreamedDocument } from '../lib/research/streamed-document';
import { ResearchUploads, verifyStorageFile } from '../lib/research/uploads';
import { uploadStatus } from '../lib/research/file-status';
import { uploadCapacityFixture } from './research-upload-capacity-fixture';
import { startResearchFlowFixture } from './research-flow-fixture';
import { createClient } from '@supabase/supabase-js';
import type { PortalRecord } from '../lib/research/portals';

function metadata(bytes: Buffer, name = 'rates.txt', contentType = 'text/plain') {
  return { name, contentType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function stream(bytes: Buffer, chunkSize = 1) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, offset + chunkSize)); offset += chunkSize;
  } });
}

test('40 simultaneous reps keep verification at two streams and duplicate polls do not download again', async () => {
  const fixture = uploadCapacityFixture(80, 256 * 1024);
  const results = await Promise.all(fixture.rows.flatMap(row => [verifyStorageFile(fixture.db, row.id), verifyStorageFile(fixture.db, row.id)]));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(fixture.stats.peak, 2);
  assert.equal(fixture.stats.downloads, 2);
  assert.equal(fixture.rows.filter(row => row.state === 'checking').length, 78);
  while (fixture.rows.some(row => row.state === 'checking')) {
    await Promise.all(fixture.rows.filter(row => row.state === 'checking').map(row => verifyStorageFile(fixture.db, row.id)));
  }
  assert.ok(fixture.rows.every(row => row.state === 'ready'));
  assert.equal(fixture.stats.downloads, 80);
  assert.equal(fixture.stats.commits, 80);
  assert.equal(fixture.stats.bufferedDownloads, 0);
});

test('a storage interruption releases capacity and retries the stored file without declaring it invalid', async () => {
  const fixture = uploadCapacityFixture(1);
  fixture.stats.failNext = true;
  await assert.rejects(verifyStorageFile(fixture.db, fixture.rows[0].id), /interrupted/);
  assert.equal(fixture.rows[0].state, 'checking');
  assert.equal(fixture.stats.active, 0);
  assert.equal(await verifyStorageFile(fixture.db, fixture.rows[0].id), true);
  assert.equal(fixture.rows[0].state, 'ready');
});

test('streamed checks preserve integrity, UTF-8, format and macro checks across chunk boundaries', async () => {
  const valid = Buffer.from('Market café rates and <htmlish identifiers');
  await validateStreamedDocument(stream(valid), metadata(valid));
  await assert.rejects(validateStreamedDocument(stream(valid), { ...metadata(valid), sha256: 'a'.repeat(64) }), /hash/);
  await assert.rejects(validateStreamedDocument(stream(valid), { ...metadata(valid), size: valid.length - 1 }), /size/);
  await assert.rejects(validateStreamedDocument(stream(valid), { ...metadata(valid), size: valid.length + 1 }), /size/);
  for (const text of ['<script>', '<html', '<' + ' '.repeat(200) + '!doctype' + ' '.repeat(200) + 'html>', 'a\0b']) {
    const bytes = Buffer.from(text);
    await assert.rejects(validateStreamedDocument(stream(bytes), metadata(bytes)), /not allowed/);
  }
  const invalidUtf8 = Buffer.from([0x61, 0xc3]);
  await assert.rejects(validateStreamedDocument(stream(invalidUtf8), metadata(invalidUtf8)), /could not be read/);
  await assert.rejects(validateStreamedDocument(stream(valid), metadata(valid, 'rates.pdf', 'application/pdf')), /extension/);
  const pdf = Buffer.from('%PDF-1.7\nresearch document\n%%EOF');
  await validateStreamedDocument(stream(pdf), metadata(pdf, 'rates.pdf', 'application/pdf'));
  for (const marker of [Buffer.from('vbaProject.bin'), Buffer.from('_VBA_PROJECT'), Buffer.from('_VBA_PROJECT', 'utf16le')]) {
    const bytes = Buffer.concat([pdf, marker]);
    await assert.rejects(validateStreamedDocument(stream(bytes), metadata(bytes, 'rates.pdf', 'application/pdf')), /Macro/);
  }
  await assert.rejects(validateStreamedDocument(stream(pdf), metadata(pdf, 'clip.mp4', 'video/mp4')), /not allowed/);
});

test('verification aborts a stalled stream and removes only its temporary scratch data', async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('final-fore-verify-')).sort();
  let cancelled = false;
  const stalled = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const check = validateStreamedDocument(stalled, metadata(Buffer.from('x')), controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(check, /abort/i);
  assert.equal(cancelled, true);
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('final-fore-verify-')).sort(), before);
});

test('time waiting for capacity is not presented as a failed upload', () => {
  assert.equal(uploadStatus({ state: 'checking', error: null, updated_at: '2020-01-01' }).state, 'checking');
});

test('the installed Supabase SDK streams a private object through verification and commits Ready', async () => {
  const fixture = await startResearchFlowFixture(0);
  try {
    const db = createClient(fixture.url, 'fixture-service-key', { auth: { persistSession: false, autoRefreshToken: false } });
    const bytes = Buffer.from('%PDF-1.7\nResearch rates\n%%EOF');
    const row = uploadCapacityFixture(1).rows[0];
    Object.assign(row, { name: 'rates.pdf', content_type: 'application/pdf', size: bytes.length, sha256: metadata(bytes).sha256 });
    fixture.tables.ff_research_files.push(row);
    fixture.objects.set(row.object_key, bytes);
    assert.equal(await verifyStorageFile(db, row.id), true);
    assert.equal(row.state, 'ready');
    assert.equal(fixture.calls.filter(call => call === 'GET /storage/v1/object/research-files/' + row.object_key).length, 1);
  } finally { await fixture.close(); }
});

test('one unavailable object does not starve other files during portal polling', async () => {
  const fixture = await startResearchFlowFixture(0);
  try {
    const db = createClient(fixture.url, 'fixture-service-key', { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = uploadCapacityFixture(2).rows;
    rows[0].created_at = '2026-01-01T00:00:00Z';
    fixture.tables.ff_research_files.push(...rows);
    fixture.objects.set(rows[1].object_key, Buffer.alloc(rows[1].size, 'x'));
    const uploads = new ResearchUploads(db);
    const portal = { id: rows[0].conversation_id, portalState: 'open' } as PortalRecord;
    await assert.rejects(uploads.refresh(portal, ''), /not available/);
    assert.ok(rows[0].recovery_checked_at);
    const result = await uploads.refresh(portal, '');
    assert.equal(result.find(row => row.id === rows[1].id)?.state, 'ready');
    assert.equal(rows[0].state, 'checking');
  } finally { await fixture.close(); }
});
