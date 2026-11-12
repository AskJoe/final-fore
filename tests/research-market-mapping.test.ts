import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS } from '../lib/domain/catalogs';
import { initial, update } from '../lib/domain/directory';
import { sourceTemplates, validateTemplate, marketChoices } from '../lib/research/templates';

// Station planner city labels cross-checked against the 2027 household/spend source.
// The row numbers identify the EPIC3/Hill entries, distinct from Turf Ops rows 83/84/86.
const mappings = [
  ['Cincinnati, OH', 'epic3-hill-cincinnati', 8],
  ['Fresno, CA', 'epic3-hill-fresno-ca', 16],
  ['Houston, TX', 'epic3-hill-houston', 18],
  ['Knoxville, TN', 'epic3-hill-knoxville', 21],
  ['Lexington, KY', 'epic3-hill-lexington-ky', 22],
  ['Memphis, TN', 'epic3-hill-memphis', 25],
  ['Nashville, TN', 'epic3-hill-nashville', 28],
  ['San Antonio, TX', 'epic3-hill-san-antonio', 31],
  ['Tampa, FL', 'epic3-hill-tampa', 35],
] as const;

test('research market links match the EPIC3/Hill source records and preserve client ownership checks', () => {
  const directory = initial(), client = directory.clients.find(c => c.id === 'epic3')!;
  for (const [label, id, sourceRow] of mappings) {
    assert.equal(MARKETS[id].buyingGroup, 'EPIC3/Hill');
    assert.equal(MARKETS[id].budgetSourceRow, sourceRow);
    assert.ok(client.marketIds.includes(id), label);
    const choice = marketChoices.find(m => m.label === label)!;
    assert.equal(choice.marketId, id);
    assert.equal(choice.needsLink, false);
    assert.throws(() => update(directory, 'clients', { name: 'Other', marketIds: [id] }), /already belongs/);
  }
  assert.ok(client.marketIds.every((id: string) => !id.startsWith('turf-ops-')));
  for (const template of sourceTemplates()) {
    assert.deepEqual(validateTemplate(template, directory, MARKETS), [], template.id);
    if (template.scope !== 'multi') continue;
    for (const [label, id] of mappings) assert.equal(template.markets.find(m => m.displayName === label)?.marketId, id);
    const unlinkedClient = structuredClone(directory);
    unlinkedClient.clients.find(c => c.id === 'epic3')!.marketIds = client.marketIds.filter((id: string) => !id.startsWith('epic3-hill-'));
    assert.equal(validateTemplate(template, unlinkedClient, MARKETS).filter(i => i.code === 'market-owner').length, 9);
  }
});
