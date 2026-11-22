import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { StorageError } from '../store';

export type SourceRef = {
  kind: 'signed-order' | 'historical-order' | 'digital-catalog' | 'broadcast-research';
  id: string;
  title: string;
  url?: string;
  locator?: string;
  version?: string;
  signedOn?: string;
  orderNumber?: string;
  priorFlight?: string;
};

export type ArchiveFile = {
  id: string; name: string; url: string; kind: string; revision: string; signedOn: string;
  market: string; marketId?: string; rep: string; firm: string; changed: string;
};

export type ArchiveLine = {
  row: number; tab: string; flight: string; days: string; weeks: string; amount: number | null;
  impressions: string; kind: string; note: string; area: string; client: string; medium: string;
  station: string; placement: string; description?: string; fmt: string; net?: string; fee?: string;
  rate?: string; spots?: string; weekly?: string; perDay?: string; aud?: string; cpm?: string;
  context: string; target?: string;
};

export type ArchiveRecord = {
  id: string; market: string; name: string; type: string; issued: string; ref: string; client: string;
  media: string; amount: number | null; basis: string; imps: string;
  targets: string[]; lines: ArchiveLine[]; source: string; version: string;
  signedOn: string; signedBy: string; note: string; signed: string | null; related: string[];
};

export type CoverageEvidence = {
  clientId: string; marketId: string; firm: string; rep: string; media: string[];
  evidence: string[];
};

export type ArchiveBilling = {
  number: string; year: number; issued: string; amount: number;
  sources: {label: string; url: string}[];
};

export type OrderArchive = {
  version: 1; year: number; orders: ArchiveRecord[];
  files: Record<string, ArchiveFile>; marketIds: Record<string, string>;
  coverage: CoverageEvidence[]; coverageYear: number | null;
  billing?: Record<string, ArchiveBilling>;
};

export const archivePathVariable = 'FINAL_FORE_ORDER_ARCHIVE_PATH';
const maxBytes = 6_000_000;
const validArchiveId = /^[\w-]{1,100}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function validSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname) &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function validateOrderArchive(raw: unknown): OrderArchive {
  if (!record(raw) || raw.version !== 1 || !Number.isInteger(raw.year) ||
      !record(raw.files) || !record(raw.marketIds) || !Array.isArray(raw.orders) ||
      !Array.isArray(raw.coverage) ||
      !(raw.coverageYear === null || Number.isInteger(raw.coverageYear))) {
    throw new Error('Invalid Order Archive manifest.');
  }
  for (const [id, file] of Object.entries(raw.files)) {
    if (!validArchiveId.test(id) || !record(file) || file.id !== id || !validSourceUrl(file.url) ||
      !['name', 'kind', 'revision', 'signedOn', 'market', 'rep', 'firm', 'changed'].every(key => typeof file[key] === 'string')) {
      throw new Error('Invalid Order Archive source file.');
    }
  }
  if (!Object.values(raw.marketIds).every(value => typeof value === 'string')) {
    throw new Error('Invalid Order Archive market map.');
  }
  const ids = new Set<string>();
  const files = raw.files as OrderArchive['files'];
  for (const order of raw.orders) {
    if (!record(order) || typeof order.id !== 'string' || !validArchiveId.test(order.id) || ids.has(order.id) ||
      typeof order.source !== 'string' || !Object.hasOwn(files, order.source) ||
      !(order.signed === null || typeof order.signed === 'string' && Object.hasOwn(files, order.signed) &&
        ['Signed order','Signed publisher plan'].includes(files[order.signed].kind)) ||
      !strings(order.related) || order.related.some(id => !Object.hasOwn(files, id)) ||
      !strings(order.targets) || !Array.isArray(order.lines) ||
      !['market','name','type','issued','ref','client','media','basis','imps','version','signedOn','signedBy','note']
        .every(key => typeof order[key] === 'string') ||
      !(order.amount === null || typeof order.amount === 'number' && Number.isFinite(order.amount))) {
      throw new Error('Invalid Order Archive record.');
    }
    ids.add(order.id);
    for (const line of order.lines as unknown[]) {
      if (!record(line) || !Number.isSafeInteger(line.row) ||
        !['tab','flight','days','weeks','impressions','kind','note','area','client','medium','station','placement','fmt','context']
          .every(key => typeof line[key] === 'string') ||
        !['target','description','net','fee','rate','spots','weekly','perDay','aud','cpm']
          .every(key => line[key] === undefined || typeof line[key] === 'string') ||
        !(line.amount === null || typeof line.amount === 'number' && Number.isFinite(line.amount))) {
        throw new Error('Invalid Order Archive placement.');
      }
    }
  }
  for (const evidence of raw.coverage) {
    if (!record(evidence) || !strings(evidence.media) || !strings(evidence.evidence) ||
      !['clientId','marketId','firm','rep'].every(key => typeof evidence[key] === 'string')) {
      throw new Error('Invalid Order Archive coverage evidence.');
    }
  }
  if (raw.billing !== undefined) {
    if (!record(raw.billing)) throw new Error('Invalid historical billing references.');
    for (const [id, detail] of Object.entries(raw.billing)) {
      if (!ids.has(id) || !record(detail) || typeof detail.number !== 'string' ||
        typeof detail.issued !== 'string' || !Number.isSafeInteger(detail.year) ||
        typeof detail.amount !== 'number' || !Number.isSafeInteger(detail.amount) || detail.amount < 0 ||
        !Array.isArray(detail.sources) || !detail.sources.length ||
        !detail.sources.every((source: unknown) => record(source) &&
          typeof source.label === 'string' && validSourceUrl(source.url))) {
        throw new Error('Invalid historical billing reference.');
      }
    }
  }
  return raw as unknown as OrderArchive;
}

let cached: { path: string; size: number; mtime: number; archive: OrderArchive } | undefined;

export async function loadOrderArchive(): Promise<OrderArchive | null> {
  const path = process.env[archivePathVariable]?.trim();
  if (!path) return null;
  try {
    if (!isAbsolute(path)) throw new Error('Use an absolute archive path.');
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid archive file size.');
    if (cached?.path === path && cached.size === info.size && cached.mtime === info.mtimeMs) return cached.archive;
    const bytes = await readFile(path);
    if (bytes.length > maxBytes) throw new Error('Invalid archive file size.');
    const archive = validateOrderArchive(JSON.parse(bytes.toString('utf8')));
    cached = { path, size: info.size, mtime: info.mtimeMs, archive };
    return archive;
  } catch {
    throw new StorageError('The configured historical orders archive could not be read.');
  }
}
