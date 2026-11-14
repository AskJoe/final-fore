import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResearchFile } from '../lib/research/uploads';

/** In-process Storage/database double. Generates bytes lazily, makes no network requests. */
export function uploadCapacityFixture(count: number, bytesPerFile = 1024) {
  const chunk = Buffer.alloc(Math.min(bytesPerFile, 64 * 1024), 'x');
  const hash = createHash('sha256');
  for (let left = bytesPerFile; left > 0; left -= chunk.length) hash.update(chunk.subarray(0, Math.min(left, chunk.length)));
  const sha256 = hash.digest('hex');
  const rows = Array.from({ length: count }, (_, index): ResearchFile => {
    const id = randomUUID();
    return { id, conversation_id: 'rep-' + Math.floor(index / 2), market_id: 'market', name: 'rates.txt', size: bytesPerFile, sha256, content_type: 'text/plain', object_key: id, state: 'checking', source: 'portal', error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  });
  const stats = { active: 0, peak: 0, downloads: 0, commits: 0, failNext: false, bufferedDownloads: 0 };
  const db = {
    from(table: string) {
      if (table !== 'ff_research_files') throw new Error('Unexpected table: ' + table);
      const filters: [string, unknown][] = [];
      const query = {
        select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        async single() {
          const row = rows.find(row => filters.every(([key, value]) => row[key as keyof ResearchFile] === value));
          return row ? { data: { ...row }, error: null } : { data: null, error: { message: 'Missing row' } };
        },
      };
      return query;
    },
    storage: { from(bucket: string) {
      if (bucket !== 'research-files') throw new Error('Unexpected bucket');
      return {
        async info(key: string) { return { data: { size: rows.find(row => row.object_key === key)!.size }, error: null }; },
        download() {
          return {
            then() { stats.bufferedDownloads++; throw new Error('Whole-file download is forbidden in the portal fixture'); },
            async asStream() {
              stats.downloads++; stats.active++; stats.peak = Math.max(stats.peak, stats.active);
              let left = bytesPerFile, closed = false;
              const end = () => { if (!closed) { closed = true; stats.active--; } };
              return { error: null, data: new ReadableStream<Uint8Array>({
                async pull(controller) {
                  // Let simultaneous callers contend before the first storage read finishes.
                  await new Promise(resolve => setImmediate(resolve));
                  if (stats.failNext) { stats.failNext = false; end(); controller.error(new TypeError('Network connection interrupted')); return; }
                  if (!left) { end(); controller.close(); return; }
                  const size = Math.min(left, chunk.length); left -= size; controller.enqueue(chunk.subarray(0, size));
                },
                cancel() { end(); },
              }) };
            },
          };
        },
      };
    } },
    async rpc(name: string, args: Record<string, string>) {
      if (name === 'ff_research_claim_portal_upload') return { data: null, error: { code: 'PGRST202', message: 'Function not found.' } };
      if (name !== 'ff_research_verify_file') throw new Error('Unexpected RPC: ' + name);
      const row = rows.find(row => row.id === args.p_file)!;
      if (row.state === 'checking') { row.state = args.p_state as ResearchFile['state']; row.error = args.p_error; stats.commits++; }
      return { error: null };
    },
  } as unknown as SupabaseClient;
  return { db, rows, stats };
}
