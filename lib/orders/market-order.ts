export function marketOrderKey(clientId: string, year: number, marketId: string) {
  return ['broadcast', clientId, year, 'market', marketId].join('|');
}

export function isMarketOrder(order: {clientId: string; year: number; marketIds: string[]; originKey?: string | null}) {
  return order.marketIds.length === 1 && order.originKey === marketOrderKey(order.clientId, order.year, order.marketIds[0]);
}
