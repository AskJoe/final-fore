import { createHmac, timingSafeEqual } from 'node:crypto';
import { check, object } from '../domain/types';
import type { OrderDocument, OrderLine, OrderSource, OrderWorkflow } from './store';

type SourceScope = { clientId: string; year: number; workflow: OrderWorkflow };
type AttestedLine = OrderLine & { source?: OrderSource & { attestation?: string } };
type LineEvidence = Pick<OrderLine, 'marketId' | 'media'> & { source: OrderSource };

function payload(scope: SourceScope, line: LineEvidence) {
  const { source } = line;
  return JSON.stringify(['ff-order-source-v1', scope.clientId, scope.year, scope.workflow,
    line.marketId, line.media, source.kind, source.id, source.label,
    source.locator ?? '', source.url ?? '', source.year ?? null]);
}

function signature(value: string, key: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function attestLine(line: OrderLine, scope: SourceScope, key: string): AttestedLine {
  if (!line.source) return line;
  return { ...line, source: { ...line.source, attestation: signature(payload(scope, { ...line, source: line.source }), key) } };
}

function readEvidence(raw: unknown): LineEvidence | undefined {
  if (!object(raw) || !object(raw.source)) return undefined;
  const source = raw.source;
  if (!(raw.media === 'TV' || raw.media === 'Radio' || raw.media === 'Digital') ||
      typeof raw.marketId !== 'string' ||
      !(source.kind === 'historical' || source.kind === 'broadcast' || source.kind === 'digital') ||
      typeof source.id !== 'string' || typeof source.label !== 'string' ||
      !(source.locator === undefined || typeof source.locator === 'string') ||
      !(source.url === undefined || typeof source.url === 'string') ||
      !(source.year === undefined || Number.isSafeInteger(source.year))) return undefined;
  return { marketId: raw.marketId, media: raw.media, source: source as OrderSource };
}

function verifySignature(value: string, candidate: unknown, key: string) {
  if (typeof candidate !== 'string' || !/^[0-9a-f]{64}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(signature(value, key), 'hex'));
}

export function verifyDraftSources(
  rawDocument: unknown,
  scope: SourceScope & { marketIds: string[] },
  key: string,
  priorDocument?: Pick<OrderDocument, 'lines'> | null,
  seedDocument?: Pick<OrderDocument, 'lines'> | null,
): void {
  if (!object(rawDocument) || !Array.isArray(rawDocument.lines)) return;
  const trusted = new Map<string, string[]>();
  for (const document of [priorDocument, seedDocument]) {
    for (const line of document?.lines ?? []) {
      const evidence = readEvidence(line);
      if (!evidence) continue;
      const allowed = trusted.get(line.id);
      const value = payload(scope, evidence);
      if (allowed) allowed.push(value);
      else trusted.set(line.id, [value]);
    }
  }
  for (const line of rawDocument.lines) {
    if (!object(line) || line.source === undefined || line.source === null) continue;
    const evidence = readEvidence(line);
    check(evidence && scope.marketIds.includes(evidence.marketId), 'Choose a source from this order’s market.');
    const value = payload(scope, evidence);
    if (typeof line.id === 'string' && trusted.get(line.id)?.includes(value)) continue;
    const source = line.source as OrderSource & { attestation?: unknown };
    check(verifySignature(value, source.attestation, key), 'This source could not be verified. Select it again in Research.');
  }
}
