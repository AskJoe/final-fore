import type { OrderLine } from './store';

export function calculatedOrderCpm(line: Pick<OrderLine,'rate'|'quantity'|'amount'|'impressions'|'audience'|'noCharge'>): number | null {
  const amount=line.noCharge ? 0 : line.amount ?? (line.rate != null && line.quantity != null ? line.rate*line.quantity : null);
  const value=amount != null && line.impressions != null && line.impressions>0
    ? amount*1000/line.impressions
    : line.rate != null && line.audience != null && line.audience>0 ? (line.noCharge?0:line.rate)*1000/line.audience : null;
  return value!==null && Number.isFinite(value) && value>=0 ? Math.round(value) : null;
}

export function replaceResearchLine(target:OrderLine,quote:OrderLine):OrderLine {
  const next={...quote,id:target.id,marketId:target.marketId,
    start:quote.start||target.start,end:quote.end||target.end,quantity:quote.quantity??target.quantity};
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
