import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDigest } from '../lib/order-assistant/digest';
test('PostgreSQL JSONB property reordering does not change proposal or revision identity',()=>{
  const written={order:2,research:1,view:4,sources:{database:{sheets:[['tv','version']],directory:3},build:'hash'}};
  const read={view:4,order:2,sources:{build:'hash',database:{directory:3,sheets:[['tv','version']]}},research:1};
  assert.equal(canonicalDigest(written),canonicalDigest(read));
  assert.notEqual(canonicalDigest(written),canonicalDigest({...read,order:3}));
  assert.notEqual(canonicalDigest(['first','second']),canonicalDigest(['second','first']));
});
