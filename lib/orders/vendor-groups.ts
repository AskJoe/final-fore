import type { OrderLine } from './store';

export function orderVendorGroups<T>(items: T[], lineOf: (item: T) => Pick<OrderLine, 'source'>) {
  const groups = new Map<string, { vendor: string; rep: string; items: T[] }>();
  for (const item of items) {
    const facts = lineOf(item).source?.facts;
    const fact = (label: string) => {
      const value = facts?.find(fact => fact.label === label)?.value;
      return typeof value === 'string' ? value.trim() : '';
    };
    const vendor = fact('Firm');
    const rep = fact('Representative');
    const key = JSON.stringify([vendor.toLowerCase(), rep.toLowerCase()]);
    const group = groups.get(key) ?? { vendor, rep, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function orderVendorLabel({ vendor, rep }: { vendor: string; rep: string }) {
  return [vendor, rep].filter(Boolean).join(' · ') || 'Vendor / rep not recorded';
}

export function isOrderAdjustment(line: Pick<OrderLine, 'source'>) {
  return line.source?.facts?.some(fact => fact.label === 'Source type' && fact.value === 'Adjustment') === true;
}
