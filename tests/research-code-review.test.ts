import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InputError } from '../lib/domain/types';
import { StorageError } from '../lib/store';
import { buildRelayPayload, decideRelay, type ReceivedMessage, type RelayContext } from '../lib/research/relay';
import { renderEmail } from '../lib/research/render';
import { sourceTemplates } from '../lib/research/templates';
import { ResearchUploads } from '../lib/research/uploads';

const context: RelayContext = {
  conversationId: 'conv-1', sarahEmail: 'sarah@example.test', from: 'Sarah <research@example.test>',
  replyDomain: 'reply.example.test', externalToken: 'a'.repeat(64), staffToken: 'b'.repeat(64),
  recipient: { to: 'rep@example.test', cc: [] },
};
const message: ReceivedMessage = {
  id: 'inbound-1', messageId: '<m@example.test>', from: '"Doe, Jane" <rep@example.test>', to: [], cc: [],
  subject: 'Research', text: 'Rates attached.', html: '', headers: {}, authentication: null, attachments: [],
};

test('a rep display name with a comma stays one quoted mailbox in the relayed From', () => {
  const from = buildRelayPayload(message, 'to-sarah', context).from;
  assert.equal(from, '"Doe, Jane via Final Fore" <research@example.test>');
  const escaped = buildRelayPayload({ ...message, from: 'Jane\\ "Doe" <rep@example.test>' }, 'to-sarah', context).from;
  assert.equal(escaped, 'Jane Doe via Final Fore <research@example.test>');
  // An ordinary name is sent exactly as it was before this fix.
  assert.equal(buildRelayPayload({ ...message, from: 'John Smith <rep@example.test>' }, 'to-sarah', context).from, 'John Smith via Final Fore <research@example.test>');
});

test('a staff reply with a failed DMARC result is held even when DKIM passes', () => {
  const staff = { ...message, from: 'Sarah <sarah@example.test>', to: [`staff-${context.staffToken}@${context.replyDomain}`] };
  assert.equal(decideRelay({ ...staff, authentication: { dkim: 'pass', dmarc: 'pass' } }, 'staff', context).action, 'to-vendor');
  assert.equal(decideRelay({ ...staff, authentication: { dkim: 'pass', dmarc: 'fail' } }, 'staff', context).action, 'held');
  // No DMARC result from the provider is not a failure: DKIM decides, as it always has.
  assert.equal(decideRelay({ ...staff, authentication: { dkim: 'pass' } }, 'staff', context).action, 'to-vendor');
  assert.equal(decideRelay({ ...staff, authentication: { dmarc: 'pass' } }, 'staff', context).action, 'held');
});

test('merge tokens naming Object.prototype members are reported missing instead of crashing', () => {
  const template = sourceTemplates()[0];
  const recipient = { repId: 'r', templateId: template.id, firmId: 'f', name: 'Jane Doe', firmName: 'Firm', to: 'rep@example.test', cc: [] };
  const email = renderEmail({ ...template, body: template.body + '\n\n{{constructor}} {{__proto__}}' }, recipient, { deadline: '2026-12-01' }, 'https://example.test/research-upload/x');
  assert.ok(email.missing.includes('constructor'));
  assert.ok(email.missing.includes('__proto__'));
  assert.ok(email.text.includes('{{constructor}} {{__proto__}}'));
});

function uploadsFailingWith(error: { code: string; message: string }) {
  const rows: Record<string, unknown> = {
    ff_research_secrets: { conversation_id: 'c1' },
    ff_research_conversations: { id: 'c1', portal_state: 'open', mode: 'live', manifest: { markets: [{ marketId: 'm1', displayName: 'Market' }] }, recipient: {} },
  };
  const db = {
    from: (table: string) => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: null }) }; return query; },
    rpc: async () => ({ data: null, error }),
  };
  return new ResearchUploads(db as unknown as SupabaseClient);
}
const file = { marketId: 'm1', name: 'rates.pdf', size: 10, sha256: 'c'.repeat(64) };

test('upload limits reach the rep as actionable messages; other failures stay storage errors', async () => {
  const token = 'd'.repeat(64);
  await assert.rejects(uploadsFailingWith({ code: 'PT429', message: 'Upload queue is busy. Retry shortly.' }).reserve(token, file),
    (e: unknown) => e instanceof InputError && /Too many files/.test(e.message));
  await assert.rejects(uploadsFailingWith({ code: '22023', message: 'Research collection storage limit reached.' }).reserve(token, file),
    (e: unknown) => e instanceof InputError && /storage limit/.test(e.message));
  await assert.rejects(uploadsFailingWith({ code: 'XX000', message: 'internal detail' }).reserve(token, file),
    (e: unknown) => e instanceof StorageError && !/internal detail/.test(e.message));
});

import { verifyStorageFile } from '../lib/research/uploads';
import { portalScanner } from '../lib/research/scanner';
import { LOGIN_ERRORS, loginPath } from '../lib/login-errors';

test('with the lease migration installed, portal verification uses a lease even while the worker flag is off', async () => {
  assert.notEqual(process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED, '1');
  const calls: string[] = [];
  // The claim already settled this file (for example, its collection was closed), so no lease is returned.
  const settled = { id: 'f1', state: 'held', upload_lease_token: null };
  const db = { rpc: async (name: string) => { calls.push(name); return { data: settled, error: null }; } } as unknown as SupabaseClient;
  assert.equal(await verifyStorageFile(db, 'f1'), true);
  assert.deepEqual(calls, ['ff_research_claim_portal_upload']);
  // Nothing due to claim is not a failure for the inline web path.
  const idle = { rpc: async (name: string) => { calls.push(name); return { data: null, error: null }; } } as unknown as SupabaseClient;
  assert.equal(await verifyStorageFile(idle, 'f2'), true);
  assert.ok(!calls.includes('ff_research_verify_file'));
});

test('retrying a failed upload replaces the stored bytes instead of re-checking them', async () => {
  const failed = { id: 'f1', conversation_id: 'c1', market_id: 'm1', name: 'rates.pdf', size: 10, sha256: 'c'.repeat(64), content_type: 'application/pdf', object_key: 'c1/f1', state: 'failed', source: 'portal', error: 'Uploaded file hash does not match.', created_at: '', updated_at: '' };
  const rows: Record<string, unknown> = {
    ff_research_secrets: { conversation_id: 'c1' },
    ff_research_conversations: { id: 'c1', portal_state: 'open', mode: 'live', manifest: { markets: [{ marketId: 'm1', displayName: 'Market' }] }, recipient: {} },
  };
  const removed: string[][] = [];
  const db = {
    from: (table: string) => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table], error: null }) }; return query; },
    rpc: async () => ({ data: failed, error: null }),
    storage: { from: () => ({
      info: async () => ({ data: { size: 9 }, error: null }),
      remove: async (keys: string[]) => { removed.push(keys); return { data: [], error: null }; },
      createSignedUploadUrl: async () => ({ data: { token: 'grant-token' }, error: null }),
    }) },
  } as unknown as SupabaseClient;
  const result = await new ResearchUploads(db).reserve('d'.repeat(64), file);
  assert.deepEqual(removed, [['c1/f1']]);
  assert.equal(result.grant?.token, 'grant-token');
  assert.equal(result.grant?.objectKey, 'c1/f1');
});

test('portal uploads are scanned only when explicitly switched on with a configured scanner', () => {
  const saved = { url: process.env.FINAL_FORE_RESEARCH_SCANNER_URL, key: process.env.FINAL_FORE_RESEARCH_SCANNER_KEY, on: process.env.FINAL_FORE_RESEARCH_SCAN_PORTAL_UPLOADS };
  try {
    delete process.env.FINAL_FORE_RESEARCH_SCANNER_URL; delete process.env.FINAL_FORE_RESEARCH_SCANNER_KEY;
    assert.equal(portalScanner(), undefined);
    process.env.FINAL_FORE_RESEARCH_SCANNER_URL = 'https://scanner.example.test/scan'; process.env.FINAL_FORE_RESEARCH_SCANNER_KEY = 'fixture-key';
    delete process.env.FINAL_FORE_RESEARCH_SCAN_PORTAL_UPLOADS;
    assert.equal(portalScanner(), undefined);
    process.env.FINAL_FORE_RESEARCH_SCAN_PORTAL_UPLOADS = '1';
    assert.equal(typeof portalScanner(), 'function');
  } finally {
    for (const [name, value] of [['FINAL_FORE_RESEARCH_SCANNER_URL', saved.url], ['FINAL_FORE_RESEARCH_SCANNER_KEY', saved.key], ['FINAL_FORE_RESEARCH_SCAN_PORTAL_UPLOADS', saved.on]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('the sign-in page only ever shows its own fixed messages', () => {
  assert.equal(loginPath({ status: 401 }), '/login');
  assert.equal(loginPath({ status: 403 }), '/login?error=access');
  assert.equal(loginPath({ status: 503 }), '/login?error=setup');
  assert.ok(!Object.hasOwn(LOGIN_ERRORS, 'Your account is locked. Call 555-0100.'));
  assert.ok(!Object.hasOwn(LOGIN_ERRORS, 'constructor'));
});
