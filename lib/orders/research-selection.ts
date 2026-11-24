import type { OrderLine } from './store';

export type ResearchSelection = { mode: 'selected' | 'unselected'; keys: ReadonlySet<string> };

function quoteKey(line: OrderLine, legacy = false) {
  const source = line.source;
  if (!source || source.kind === 'historical') return undefined;

  const origin = [line.marketId, line.media, source.kind, source.id, source.year ?? null];
  if (source.kind === 'digital') return JSON.stringify(origin);
  if (source.researchRowId && !legacy) return JSON.stringify([...origin, 'row', source.researchRowId]);

  const locator = source.locator || source.facts?.find(fact => fact.label === 'Source row')?.value;
  return locator ? JSON.stringify([...origin, 'source', locator]) : undefined;
}

export function selectedResearchKeys(lines: OrderLine[]) {
  return [...new Set(lines.map(line => quoteKey(line)).filter((key): key is string => key !== undefined))].sort();
}

export function isResearchSelected(row: { line: OrderLine | null; periods?: { line: OrderLine }[] }, keys: ReadonlySet<string>) {
  if (!keys.size) return false;
  const quotes = row.periods?.map(period => period.line) ?? (row.line ? [row.line] : []);
  return quotes.some(line => {
    const key = quoteKey(line);
    const legacyKey = quoteKey(line, true);
    return (key !== undefined && keys.has(key)) || (legacyKey !== undefined && keys.has(legacyKey));
  });
}
