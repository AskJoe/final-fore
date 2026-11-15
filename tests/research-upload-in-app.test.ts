import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '../lib/research/secrets';
import { ResearchUploads } from '../lib/research/uploads';
import { uploadCapacityFixture } from './research-upload-capacity-fixture';
import { startResearchFlowFixture } from './research-flow-fixture';

test('the app finishes stored portal uploads even when a separate worker is enabled and idle', async t => {
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
  fixture.tables.ff_research_conversations.push({ id: current.conversation_id, mode: 'live', portal_state: 'open' });
  fixture.tables.ff_research_secrets.push({ conversation_id: current.conversation_id, portal_hash: hashToken(token) });

  const leases = new Map<string, string>();
  const db = createClient(fixture.url, 'fixture-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      async fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : String(input));
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
  assert.equal(fixture.calls.filter(call => call === 'GET /storage/v1/object/research-files/' + current.object_key).length, 1);

  const portal = await uploads.portal(token);
  const files = await uploads.refresh(portal, token);
  assert.equal(files.find(file => file.id === previous.id)?.state, 'ready');
  assert.equal(fixture.calls.filter(call => call === 'GET /storage/v1/object/research-files/' + previous.object_key).length, 1);
});
