/** Real local Postgres lease tests, with synthetic Storage served only on loopback.
 * Creates and retains a dedicated test database; never changes the working app database.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { claimUpload, processUploadLease, uploadQueueStatus } from '../lib/research/upload-leases';
import { ResearchUploads } from '../lib/research/uploads';
import type { PortalRecord } from '../lib/research/portals';

const container = 'supabase_db_final-fore-local';
const database = 'ff_upload_test_' + Date.now();
const docker = ['--context', 'desktop-linux', 'exec', '-i', container];
function sqlLiteral(value: unknown): string { return value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'"; }
function sql(query: string, name = database): string {
  return execFileSync('docker', [...docker, 'psql', '-X', '-U', 'postgres', '-d', name, '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function asyncSql(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...docker, 'psql', '-X', '-U', 'postgres', '-d', database, '-Atq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', value => { out += value; }); child.stderr.on('data', value => { err += value; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    child.stdin.end(query);
  });
}
const checks: string[] = [];
function passed(message: string) { checks.push(message); console.log('PASS ' + message); }
const bytes = Buffer.from('Research rates, verified without an email worker.');
const objects = new Map<string, Buffer>();
const receipts = new Map<string, number>();
const failingObjects = new Set<string>();
const holds = new Map<string, { arrived: () => void; released: Promise<void> }>();
const calls: string[] = [];
function createFile(options: { state?: string; source?: string; ageMinutes?: number; closed?: boolean; expired?: boolean; stored?: Buffer | null } = {}) {
  const id = randomUUID(), conversation = randomUUID();
  sql(`insert into ff_research_conversations(id,portal_state,expires_at) values(${sqlLiteral(conversation)},${sqlLiteral(options.closed ? 'closed' : 'open')},${options.expired ? "now()-interval '1 minute'" : 'null'});
    insert into ff_research_files(id,conversation_id,market_id,name,size,sha256,content_type,object_key,state,source,created_at)
    values(${sqlLiteral(id)},${sqlLiteral(conversation)},'test-market','rates.txt',${bytes.length},${sqlLiteral(createHash('sha256').update(bytes).digest('hex'))},'text/plain',${sqlLiteral(id)},${sqlLiteral(options.state ?? 'checking')},${sqlLiteral(options.source ?? 'portal')},now()-make_interval(mins=>${options.ageMinutes ?? 0}));`);
  if (options.stored !== null) objects.set(id, options.stored ?? bytes);
  return { id, conversation };
}
function file(id: string) { return JSON.parse(sql(`select to_jsonb(f) from ff_research_files f where id=${sqlLiteral(id)};`)); }
function due(id: string) { sql(`update ff_research_files set upload_available_at=now()-interval '1 second' where id=${sqlLiteral(id)};`); }
function expire(id: string) { sql(`update ff_research_files set upload_lease_until=now()-interval '1 second' where id=${sqlLiteral(id)};`); }
const functions: Record<string, string[]> = {
  ff_research_claim_portal_upload: ['p_file'], ff_research_promote_portal_upload: ['p_file', 'p_lease'],
  ff_research_finish_portal_upload: ['p_file', 'p_lease', 'p_state', 'p_error'], ff_research_upload_queue_status: [],
  ff_research_finalize_file: ['p_conversation', 'p_file'],
};
function childWorker(url: string, onceOnly = true) {
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'fixture-service-key', FINAL_FORE_RESEARCH_WRITES_ENABLED: '1', FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED: '1', FINAL_FORE_RESEARCH_SEND_ENABLED: '0' };
  for (const key of Object.keys(env)) if (/RESEND|SCANNER|FINAL_FORE_RESEARCH_SECRET_KEY/.test(key)) delete env[key as keyof typeof env];
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/research-upload-worker.ts', ...(onceOnly ? ['--once'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { errors += value; });
  const done = new Promise<string>((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(errors || output))); });
  return { child, done, output: () => output };
}
async function within<T>(promise: Promise<T>, milliseconds = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Local worker test timed out')), milliseconds); })]); }
  finally { clearTimeout(timer!); }
}

async function main() {
  assert.match(database, /^ff_upload_test_\d+$/);
  const before = sql("select jsonb_build_object('records',(select count(*) from ff_records),'files',(select count(*) from ff_research_files),'messages',(select count(*) from ff_research_messages),'deliveries',(select count(*) from ff_research_deliveries),'leaseColumns',(select count(*) from information_schema.columns where table_schema='public' and table_name='ff_research_files' and column_name='upload_lease_token'));", 'postgres');
  sql(`create database ${database};`, 'postgres');
  console.log('Dedicated synthetic test database: ' + database);
  // Only dependencies of the real file migration are supplied by this fixture.
  sql(`create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table ff_members(user_id uuid primary key);
    create table ff_research_conversations(id uuid primary key,portal_state text not null default 'open',expires_at timestamptz,updated_at timestamptz not null default now());
    create table ff_research_jobs(id uuid primary key default gen_random_uuid(),operation_key text unique,kind text,payload jsonb,state text default 'queued',error text,available_at timestamptz default now());
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text);
    grant usage on schema public,storage,auth to service_role,anon,authenticated;`);
  sql(await readFile('supabase/migrations/20261111122000_research_files.sql', 'utf8'));
  sql(await readFile('supabase/migrations/20261112160000_research_upload_leases.sql', 'utf8'));
  passed('actual file migration and new lease migration applied to dedicated PostgreSQL 17 test database');
  for (const role of ['anon', 'authenticated']) {
    for (const signature of ['ff_research_claim_portal_upload(uuid)', 'ff_research_promote_portal_upload(uuid,uuid)', 'ff_research_finish_portal_upload(uuid,uuid,text,text)', 'ff_research_upload_queue_status()']) {
      assert.equal(sql(`select has_function_privilege(${sqlLiteral(role)},${sqlLiteral(signature)},'EXECUTE');`), 'f');
      assert.equal(sql(`select has_function_privilege('service_role',${sqlLiteral(signature)},'EXECUTE');`), 't');
    }
  }
  passed('new RPCs executable only by service role, not anonymous or authenticated browser roles');

  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://127.0.0.1'); calls.push(request.method + ' ' + url.pathname);
    const send = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    try {
      if (request.headers.authorization !== 'Bearer fixture-service-key') { send({ message: 'Fixture authentication required' }, 401); return; }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').at(-1)!;
        assert.ok(Object.hasOwn(functions, name), 'No email or unrelated RPC permitted: ' + name);
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const result = await asyncSql(`set role service_role; select to_jsonb(public.${name}(${functions[name].map(key => sqlLiteral(body[key] ?? null)).join(',')}));`);
        send(result ? JSON.parse(result) : null); return;
      }
      if (url.pathname === '/rest/v1/ff_research_files') {
        assert.equal(request.method, 'GET');
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        let rows;
        if (id) rows = [file(id)];
        else {
          assert.ok(url.searchParams.get('conversation_id')?.startsWith('eq.'));
          const conversation = url.searchParams.get('conversation_id')!.slice(3);
          rows = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(f)),'[]') from ff_research_files f where conversation_id=${sqlLiteral(conversation)} and source='portal';`));
        }
        send(request.headers.accept?.includes('application/vnd.pgrst.object+json') ? rows[0] : rows); return;
      }
      if (url.pathname.startsWith('/storage/v1/object/info/research-files/')) {
        const id = url.pathname.split('/').at(-1)!, stored = objects.get(id);
        assert.equal(request.method, 'GET');
        receipts.set(id, (receipts.get(id) ?? 0) + 1);
        if (failingObjects.delete(id)) { response.destroy(); return; }
        const hold = holds.get(id); if (hold) { hold.arrived(); await hold.released; }
        send(stored ? { size: stored.length } : { statusCode: '404', error: 'not_found', message: 'Not found' }, stored ? 200 : 404); return;
      }
      throw new Error('Unexpected API request: ' + url.pathname);
    } catch (error) { send({ message: error instanceof Error ? error.message : 'Fixture failure' }, 500); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port;
  const db = createClient(url, 'fixture-service-key', { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const first = createFile();
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimUpload(db, first.id)));
    const winner = claims.find(Boolean)!; assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await processUploadLease(db, winner), 'finished'); assert.equal(file(first.id).state, 'ready');
    assert.equal(receipts.get(first.id), 1);
    passed('12 simultaneous database connections yield one lease and one Storage metadata request');

    const crashed = createFile(), old = (await claimUpload(db, crashed.id))!;
    expire(crashed.id);
    assert.equal((await db.rpc('ff_research_finish_portal_upload', { p_file: crashed.id, p_lease: old.upload_lease_token, p_state: 'ready' })).data, false);
    const replacement = (await claimUpload(db, crashed.id))!;
    assert.notEqual(old.upload_lease_token, replacement.upload_lease_token);
    assert.equal((await db.rpc('ff_research_finish_portal_upload', { p_file: crashed.id, p_lease: old.upload_lease_token, p_state: 'failed' })).data, false);
    assert.equal(await processUploadLease(db, replacement), 'finished');
    assert.equal(file(crashed.id).state, 'ready');
    passed('expired/crashed lease is reclaimed; stale completion cannot overwrite its replacement');

    sql(`do $$ begin
      begin perform ff_research_verify_file(${sqlLiteral(crashed.id)},'failed','unleased overwrite');
        raise exception 'Unleased portal write unexpectedly succeeded';
      exception when insufficient_privilege then null; end;
    end $$;`);
    assert.equal(file(crashed.id).state, 'ready');
    passed('legacy unleased verification RPC cannot overwrite portal results');

    const retry = createFile(); failingObjects.add(retry.id);
    assert.equal(await processUploadLease(db, (await claimUpload(db, retry.id))!), 'retry');
    assert.equal(file(retry.id).state, 'checking'); assert.equal(file(retry.id).upload_attempts, 1);
    assert.ok(Date.parse(file(retry.id).upload_available_at) > Date.now());
    assert.equal(await claimUpload(db, retry.id), null); due(retry.id);
    assert.equal(await processUploadLease(db, (await claimUpload(db, retry.id))!), 'finished');
    assert.equal(file(retry.id).state, 'ready');
    passed('transient Storage failure retains bytes, enforces database backoff, then completes');

    const exhausted = createFile();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const lease = (await claimUpload(db, exhausted.id))!;
      assert.equal(lease.upload_attempts, attempt);
      const ack = await db.rpc('ff_research_finish_portal_upload', { p_file: exhausted.id, p_lease: lease.upload_lease_token, p_state: 'retry' });
      assert.equal(ack.data, true); if (attempt < 5) due(exhausted.id);
    }
    assert.equal(file(exhausted.id).state, 'failed');
    assert.equal(await claimUpload(db, exhausted.id), null);
    sql(`set role service_role; select ff_research_finalize_file(${sqlLiteral(exhausted.conversation)},${sqlLiteral(exhausted.id)});`);
    assert.equal(file(exhausted.id).upload_attempts, 0);
    assert.equal(await processUploadLease(db, (await claimUpload(db, exhausted.id))!), 'finished');
    passed('five unsuccessful attempts become actionable failure; explicit retry resets attempts and succeeds');

    const repeatedCrash = createFile();
    for (let attempt = 0; attempt < 5; attempt++) { assert.ok(await claimUpload(db, repeatedCrash.id)); expire(repeatedCrash.id); }
    assert.equal((await claimUpload(db, repeatedCrash.id))!.state, 'failed');
    passed('repeated worker crashes also exhaust the bounded retry budget');

    const changed = createFile(), heldLease = (await claimUpload(db, changed.id))!;
    sql(`update ff_research_conversations set portal_state='closed' where id=${sqlLiteral(changed.conversation)};`);
    await processUploadLease(db, heldLease); assert.equal(file(changed.id).state, 'held');
    for (const options of [{ closed: true }, { expired: true }]) {
      const closed = createFile(options), claim = (await claimUpload(db, closed.id))!;
      assert.equal(claim.state, 'held'); assert.equal(claim.upload_lease_token, null); assert.equal(receipts.has(closed.id), false);
    }
    passed('closed/expired collections never become Ready, including closure during a lease');

    const missing = createFile({ state: 'uploading', ageMinutes: 5, stored: null });
    await processUploadLease(db, (await claimUpload(db, missing.id))!);
    assert.equal(file(missing.id).state, 'uploading'); assert.equal(file(missing.id).upload_attempts, 0);
    sql(`update ff_research_files set created_at=now()-interval '31 minutes',upload_available_at=now() where id=${sqlLiteral(missing.id)};`);
    await processUploadLease(db, (await claimUpload(db, missing.id))!);
    assert.equal(file(missing.id).state, 'failed');
    const fresh = createFile({ state: 'uploading' }); assert.equal(await claimUpload(db, fresh.id), null);
    sql(`update ff_research_files set state='failed' where id=${sqlLiteral(fresh.id)};`);
    passed('unfinished uploads get a two-minute grace period and are retried until the 30-minute abandonment limit');

    const email = createFile({ source: 'email' });
    sql("insert into ff_research_jobs(operation_key,kind,payload) values('mail-sentinel','receive','{}');");
    assert.equal(await claimUpload(db, email.id), null);
    const recovered = createFile({ state: 'uploading', ageMinutes: 3 });
    const queued = createFile();
    const outputs = await Promise.all([childWorker(url).done, childWorker(url).done]);
    assert.ok(outputs.every(output => output.includes('upload-worker-stopped')));
    assert.equal(file(recovered.id).state, 'ready'); assert.equal(file(queued.id).state, 'ready');
    assert.equal(receipts.get(recovered.id), 1); assert.equal(receipts.get(queued.id), 1);
    assert.equal(file(email.id).state, 'checking');
    assert.equal(sql("select state from ff_research_jobs where operation_key='mail-sentinel';"), 'queued');
    assert.ok(calls.every(call => !/deliveries|messages|receive|resend|\/object\/research-files\//.test(call)));
    passed('two concurrent workers recover browser-abandoned uploads using Storage metadata only');

    const unfinalized = createFile({ state: 'uploading' });
    const jobsBefore = sql('select count(*) from ff_research_jobs;');
    sql(`set role service_role; select ff_research_finalize_file(${sqlLiteral(unfinalized.conversation)},${sqlLiteral(unfinalized.id)});`);
    assert.equal(file(unfinalized.id).state, 'checking');
    assert.equal(sql('select count(*) from ff_research_jobs;'), jobsBefore);
    await processUploadLease(db, (await claimUpload(db, unfinalized.id))!);
    passed('finalization durably queues a portal file without inserting a mail job');

    const draining = [createFile(), createFile()];
    const release: (() => void)[] = [];
    const arrived = draining.map(row => new Promise<void>(reached => {
      const released = new Promise<void>(resolve => release.push(resolve));
      holds.set(row.id, { arrived: reached, released });
    }));
    const watching = childWorker(url, false);
    try {
      await within(Promise.all(arrived));
      // Signal only the synthetic worker this script just created, never an app/service process.
      assert.equal(watching.child.kill('SIGTERM'), true);
      await within((async () => { while (!watching.output().includes('upload-worker-stopping')) await once(watching.child.stdout, 'data'); })());
    } finally {
      for (const done of release) done();
      if (!watching.output().includes('upload-worker-stopping')) watching.child.kill('SIGTERM');
    }
    const stopped = await within(watching.done);
    assert.ok(stopped.includes('"graceful":true'));
    assert.ok(draining.every(row => file(row.id).state === 'ready'));
    passed('SIGTERM drains both in-flight files and exits gracefully without claiming another batch');

    const previous = process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED;
    process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED = '1';
    try {
      const uploads = new ResearchUploads(db), count = calls.length;
      await uploads.refresh({ id: recovered.conversation, portalState: 'open' } as PortalRecord, '');
      assert.ok(calls.slice(count).every(call => !call.includes('/storage/')));
    } finally { if (previous === undefined) delete process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED; else process.env.FINAL_FORE_RESEARCH_UPLOAD_WORKER_ENABLED = previous; }
    passed('worker-enabled web polling only reads file status');

    const status = await uploadQueueStatus(db); assert.equal(status.active, 0);
    assert.equal(sql("select jsonb_build_object('records',(select count(*) from ff_records),'files',(select count(*) from ff_research_files),'messages',(select count(*) from ff_research_messages),'deliveries',(select count(*) from ff_research_deliveries),'leaseColumns',(select count(*) from information_schema.columns where table_schema='public' and table_name='ff_research_files' and column_name='upload_lease_token'));", 'postgres'), before);
    passed('working application database counts and lease-column state unchanged');
    const report = { checkedAt: new Date().toISOString(), database, retainedForReview: true, checks, queue: status, workerOutputs: outputs, limitation: 'Real PostgreSQL migration/locks and real worker processes; synthetic loopback Storage, not hosted Supabase/Render or a full schema clone.' };
    await writeFile('docs/upload-worker-test-results.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ database, passed: checks.length, failed: 0, report: 'docs/upload-worker-test-results.json' }));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error); console.error('Test database retained for inspection: ' + database); process.exitCode = 1; });
