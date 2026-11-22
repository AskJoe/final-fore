import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict, InputError } from '../lib/domain/types';
import { AccessError } from '../lib/access';
import { cleanOrderDocument, orderLineAmount, orderStore, orderTotal, validateOrderForIssue } from '../lib/orders/store';

const scope = { marketIds: ['epic3-arkansas-nwa'], workflow: 'digital' as const };
const line = { id: 'line-1', media: 'Digital', marketId: scope.marketIds[0], program: 'Streaming Audio',
  rate: 1250, quantity: 2 };
const paper = { number: 'TEST-2027', date: '2027-02-01', clientName: 'EPIC3', vendor: 'Vendor',
  buyer: 'Final Fore Media', buyerEmail: 'buyer@example.test', billing: 'Billing contact', terms: 'Reviewed order terms',
  start: '2027-02-10', end: '2027-02-15', lines: [line] };

test('draft validates scope and computes canonical prices in cents', () => {
  const document = cleanOrderDocument({ ...paper, total: 999999999,
    lines: [line, {...line, id: 'line-2', amount: 3500}, {...line, id: 'line-3', noCharge: true}] }, scope);
  assert.equal(document.lines.length, 3);
  assert.deepEqual(document.lines.map(orderLineAmount), [2500, 3500, 0]);
  assert.equal(orderTotal(document), 6000);
  assert.equal(Object.hasOwn(document, 'total'), false);
  assert.doesNotThrow(() => validateOrderForIssue(document));
  assert.throws(() => cleanOrderDocument({...paper, lines: [line, line]}, scope), /unique/);
  assert.throws(() => cleanOrderDocument({...paper, lines: [{...line, marketId: 'epic3-austin'}]}, scope), /market/);
  assert.throws(() => cleanOrderDocument({...paper, lines: [{...line, media: 'TV'}]}, scope), /only digital/);
  assert.throws(() => cleanOrderDocument({...paper, lines: [{...line, amount: 9.99}]}, scope), /whole number/);
});

test('incomplete working drafts save and fail official issue validation', () => {
  const blank = cleanOrderDocument({lines: []}, scope);
  assert.throws(() => validateOrderForIssue(blank), InputError);
  const missingPrice = cleanOrderDocument({...paper, lines: [{...line, rate: null}]}, scope);
  assert.equal(orderLineAmount(missingPrice.lines[0]), null);
  assert.throws(() => validateOrderForIssue(missingPrice), /Price every placement/);
  assert.throws(() => cleanOrderDocument({...paper, start: '2027-02-29'}, scope), /valid flight start/);
  assert.throws(() => cleanOrderDocument({...paper, lines: [{...line, end: '2027-01-10'}]}, scope), /ends before/);
  assert.throws(() => cleanOrderDocument({...paper, lines: [{...line, source: {
    kind: 'historical', id: 'source', label: 'Source', url: 'javascript:alert(1)'
  }}]}, scope), /valid source reference/);
});

test('order RPC forwards signed actor and operation and preserves expected error semantics', async () => {
  const received: {name: string; params: unknown}[] = [];
  let result: {data: unknown; error: {code: string; message: string} | null} =
    {data: {revision: 4}, error: null};
  const db = {rpc: async (name: string, params: unknown) => {
    received.push({name, params});
    return result;
  }} as unknown as Pick<SupabaseClient, 'rpc'>;
  const store = orderStore(db);
  const payload = {id: 'test-order', expectedRevision: 3, operationId: 'request-1'};
  await store.command('signed-in-member', 'createRevision', payload);
  assert.deepEqual(received, [{name: 'ff_orders_command', params: {
    p_actor_id: 'signed-in-member', p_action: 'createRevision', p_input: payload,
  }}]);
  for (const code of ['PT409','40001','23505']) {
    result = {data: null, error: {code, message: 'stale'}};
    await assert.rejects(store.command('signed-in-member', 'createRevision', payload), Conflict);
  }
  result = {data: null, error: {code: 'PT404', message: 'unavailable'}};
  await assert.rejects(store.command('signed-in-member', 'createRevision', payload),
    error => error instanceof AccessError && error.status === 404);
});
