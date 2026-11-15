import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '../lib/research/secrets';
import { ResearchInbox } from '../lib/research/inbox';
import { ResearchUploads } from '../lib/research/uploads';
import { uploadCapacityFixture } from './research-upload-capacity-fixture';
import { startResearchFlowFixture } from './research-flow-fixture';

test('new and older stored portal uploads open through Storage without rereading their contents', async t => {
  const workerFlag = process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED;
  process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED = '1';
  t.after(() => {
    if (workerFlag === undefined) delete process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED;
    else process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED = workerFlag;
  });

  const fixture = await startResearchFlowFixture(0);
  t.after(() => fixture.close());
  const token = 'a'.repeat(64);
  const bytes = Buffer.from('%PDF-1.7\nResearch rates\n%%EOF');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const rows = uploadCapacityFixture(2).rows;
  for (const row of rows) {
    Object.assign(row, { name: 'rates.pdf', content_type: 'application/pdf', size: bytes.length, sha256 });
    fixture.tables.ff_research_files.push(row);
    fixture.objects.set(row.object_key, bytes);
  }
  const [current, previous] = rows;
  current.state = 'uploading';
  current.conversation_id = randomUUID();
  previous.conversation_id = current.conversation_id;
  const manifest = { clientId: 'client', campaignKey: 'campaign', media: 'broadcast-tv', markets: [{ marketId: 'market', displayName: 'Market' }] };
  const recipient = { name: 'Rep', firmName: 'Vendor' };
  fixture.tables.ff_research_conversations.push({ id: current.conversation_id, mode: 'live', portal_state: 'open', manifest, recipient });
  fixture.tables.ff_research_secrets.push({ conversation_id: current.conversation_id, portal_hash: hashToken(token) });
  const email = { ...previous, id: randomUUID(), object_key: randomUUID(), source: 'email' };
  fixture.tables.ff_research_files.push(email);
  fixture.objects.set(email.object_key, bytes);
  const incomplete = { ...previous, id: randomUUID(), object_key: randomUUID(), state: 'uploading' };
  fixture.tables.ff_research_files.push(incomplete);

  const leases = new Map<string, string>();
  const db = createClient(fixture.url, 'fixture-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      async fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const signPrefix = '/storage/v1/object/sign/research-files/';
        if (url.pathname.startsWith(signPrefix)) {
          const key = url.pathname.slice(signPrefix.length);
          assert.ok(fixture.objects.has(key));
          assert.equal(JSON.parse(String(init?.body)).expiresIn, 30);
          return Response.json({ signedURL: '/object/sign/research-files/' + key + '?token=fixture' });
        }
        if (url.pathname.endsWith('/rpc/ff_research_claim_portal_upload')) {
          const { p_file } = JSON.parse(String(init?.body));
          const row = rows.find(item => item.id === p_file && item.state === 'checking');
          if (!row || leases.has(row.id)) return Response.json(null);
          const lease = randomUUID();
          leases.set(row.id, lease);
          return Response.json({ ...row, upload_lease_token: lease });
        }
        if (url.pathname.endsWith('/rpc/ff_research_finish_portal_upload')) {
          const { p_file, p_lease, p_state, p_error } = JSON.parse(String(init?.body));
          const row = rows.find(item => item.id === p_file)!;
          assert.equal(leases.get(row.id), p_lease);
          Object.assign(row, { state: p_state, error: p_error });
          leases.delete(row.id);
          return Response.json(true);
        }
        return fetch(input, init);
      },
    },
  });

  const uploads = new ResearchUploads(db);
  assert.equal((await uploads.finalize(token, current.id)).state, 'ready');
  await assert.rejects(uploads.finalize(token, incomplete.id), /Stored file is not available/);
  assert.equal(current.state, 'ready');
  assert.equal(previous.state, 'checking');

  const portal = await uploads.portal(token);
  const inbox = new ResearchInbox(db, 'staff');
  const incoming = (await inbox.incoming()).groups.flatMap(group => group.files);
  assert.equal(incoming.find(file => file.id === previous.id)?.state, 'ready');
  assert.equal(incoming.find(file => file.id === current.id)?.state, 'ready');
  assert.equal(incoming.find(file => file.id === email.id)?.state, 'checking');
  assert.equal(incoming.find(file => file.id === incomplete.id)?.state, 'uploading');
  assert.equal((await inbox.list()).conversations[0].fileCount, 2);
  for (const file of [current, previous]) {
    const path = '/storage/v1/object/sign/research-files/' + file.object_key;
    assert.equal(new URL(await inbox.download(file.id)).pathname, path);
    assert.equal(new URL(await uploads.download(portal, file.id)).pathname, path);
  }
  await assert.rejects(inbox.download(email.id), /not ready/);
  await assert.rejects(inbox.download(incomplete.id), /not ready/);
  assert.equal(fixture.calls.filter(call => call.startsWith('GET /storage/v1/object/research-files/')).length, 0);
});
