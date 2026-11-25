import type { OrderLine } from './store';

export function isBroadcastPlacement(line: Pick<OrderLine, 'media'>) {
  return line.media === 'TV' || line.media === 'Radio';
}

type PricedLine = Pick<OrderLine, 'noCharge' | 'amount' | 'rate' | 'quantity' | 'feeBasisPoints'>;

export function orderLineCharges(line: PricedLine) {
  const media = line.noCharge ? 0 : line.amount ??
    (line.rate != null && line.quantity != null ? line.rate * line.quantity : null);
  const fee = media === null ? null : Math.round(media * (line.feeBasisPoints ?? 0) / 10000);
  return { media, fee, due: media === null || fee === null ? null : media + fee };
}

export function calculatedOrderCpm(line: Pick<OrderLine,'rate'|'quantity'|'amount'|'impressions'|'audience'|'noCharge'>): number | null {
  const amount=line.noCharge ? 0 : line.amount ?? (line.rate != null && line.quantity != null ? line.rate*line.quantity : null);
  const value=amount != null && line.impressions != null && line.impressions>0
    ? amount*1000/line.impressions
    : line.rate != null && line.audience != null && line.audience>0 ? (line.noCharge?0:line.rate)*1000/line.audience : null;
  return value!==null && Number.isFinite(value) && value>=0 ? Math.round(value) : null;
}

export function replaceResearchLine(target:OrderLine,quote:OrderLine):OrderLine {
  const digital = quote.media === 'Digital';
  const quantity = digital ? quote.quantity ?? target.quantity : target.quantity ?? quote.quantity;
  const scheduleChanged = !digital && quantity !== quote.quantity;
  const next = { ...quote, id: target.id, marketId: target.marketId, quantity,
    start: target.start || quote.start, end: target.end || quote.end,
    ...(scheduleChanged && { amount: null, impressions: quote.audience != null && quantity != null ? quote.audience * quantity : null }),
    ...(scheduleChanged && quote.media === 'Radio' && quote.spotsPerWeek != null &&
      { weeks: target.weeks ?? quote.weeks, spotsPerWeek: target.spotsPerWeek ?? null }) };
  return {...next,calculatedCpm:calculatedOrderCpm(next)};
}

export function spreadsheetScheduleChanges(line: OrderLine, changes: Partial<OrderLine>): Partial<OrderLine> {
  const next = { ...line, ...changes };
  if (('spotsPerWeek' in changes || 'weeks' in changes) && next.spotsPerWeek != null && next.weeks != null) {
    const scheduledSpots = Math.round(next.spotsPerWeek * next.weeks);
    if (scheduledSpots !== line.quantity) changes = { ...changes, quantity: scheduledSpots };
  }
  const spots = 'quantity' in changes ? changes.quantity : line.quantity;
  if ('quantity' in changes || 'audience' in changes) {
    // Preserve a booked measurement when only the rate or a text field changes.
    const impressions = next.audience != null && spots != null ? next.audience * spots : null;
    if (impressions != null || 'quantity' in changes) changes = { ...changes, impressions };
  }
  return changes;
}
