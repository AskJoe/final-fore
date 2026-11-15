const groupOrder = new Intl.Collator('en', { numeric: true });

export type GroupBucket<Row> = { label: string; rows: Row[] };

export function groupRows<Row>(rows: readonly Row[], valueFor: (row: Row) => string): GroupBucket<Row>[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const value = valueFor(row);
    const existing = groups.get(value);
    if (existing) existing.push(row);
    else groups.set(value, [row]);
  }
  return Array.from(groups, ([label, items]) => ({ label, rows: items }))
    .sort((left, right) => groupOrder.compare(left.label, right.label));
}

export function rowsByPeriod<Row>(
  rows: readonly Row[],
  identityFor: (row: Row) => string,
  periodFor: (row: Row) => string,
): Map<string, Row>[] {
  const series = new Map<string, Map<string, Row>[]>();
  for (const row of rows) {
    const identity = identityFor(row);
    const period = periodFor(row);
    const lines = series.get(identity) ?? [];
    let line = lines.find(candidate => !candidate.has(period));
    if (!line) {
      line = new Map();
      lines.push(line);
      series.set(identity, lines);
    }
    line.set(period, row);
  }
  return Array.from(series.values()).flat();
}
