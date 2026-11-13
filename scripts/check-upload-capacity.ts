// Synthetic, local-only Storage/database fixture. No real recipients, uploads, or services touched.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { verifyStorageFile } from '../lib/research/uploads';
import { uploadCapacityFixture } from '../tests/research-upload-capacity-fixture';

async function main() {
  const results = [];
  for (const [files, mib] of [[80, 10], [2, 100]]) {
    const fixture = uploadCapacityFixture(files, mib * 1024 * 1024);
    const start = performance.now(), baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss, busyResponses = 0;
    const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
    try {
      while (fixture.rows.some(row => row.state === 'checking')) {
        const round = await Promise.all(fixture.rows.filter(row => row.state === 'checking').flatMap(row => [verifyStorageFile(fixture.db, row.id), verifyStorageFile(fixture.db, row.id)]));
        busyResponses += round.filter(result => !result).length;
        assert.ok(performance.now() - start < 120000, 'Synthetic batch must drain within two minutes');
      }
    } finally { clearInterval(sample); }
    assert.ok(fixture.rows.every(row => row.state === 'ready'));
    assert.equal(fixture.stats.peak, 2);
    assert.equal(fixture.stats.downloads, files);
    assert.equal(fixture.stats.bufferedDownloads, 0);
    results.push({ files, mibPerFile: mib, simultaneousRequests: files * 2, completed: fixture.stats.commits, uniqueDownloads: fixture.stats.downloads, peakConcurrentStreams: fixture.stats.peak, busyResponses, seconds: Number(((performance.now() - start) / 1000).toFixed(2)), baselineRssMiB: Number((baselineRss / 1024 ** 2).toFixed(1)), peakRssMiB: Number((peakRss / 1024 ** 2).toFixed(1)) });
  }
  const report = { testedAt: new Date().toISOString(), environment: 'local Node process; simulated Supabase; not Render or network load testing', results };
  await writeFile('docs/upload-capacity-test-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
