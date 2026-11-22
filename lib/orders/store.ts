import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../access';
import { Conflict, InputError, check, object } from '../domain/types';
import { StorageError } from '../store';

export type OrderWorkflow = 'broadcast' | 'digital';
export type OrderSource = {
  kind: 'historical' | 'broadcast' | 'digital';
  id: string;
  label: string;
  locator?: string;
  url?: string;
  year?: number;
};
export type OrderLine = {
  id: string;
  media: 'TV' | 'Radio' | 'Digital';
  marketId: string;
  station: string;
  program: string;
  format: string;
  days: string;
  start: string;
  end: string;
  rate: number | null;
  quantity: number | null;
  amount: number | null;
  impressions: number | null;
  noCharge: boolean;
  notes: string;
  priorFlight?: string;
  weeks?: number | null;
  spotsPerDay?: number | null;
  spotsPerWeek?: number | null;
  audience?: number | null;
  cpm?: number | null;
  source?: OrderSource;
};
export type OrderDocument = {
  number: string;
  date: string;
  clientName: string;
  vendor: string;
  rep: string;
  buyer: string;
  buyerEmail: string;
  billing: string;
  terms: string;
  start: string;
  end: string;
  notes: string;
  lines: OrderLine[];
};
export type OrderIssue = {
  id: string;
  revision: number;
  issuedAt: string;
  sha256: string;
  bytes: number;
  templateVersion: string;
  number: string;
  storageKey?: string;
  downloaded: boolean;
  sent: boolean;
};
export type OrderSummary = {
  id: string;
  clientId: string;
  year: number;
  marketIds: string[];
  workflow: OrderWorkflow;
  originKey: string | null;
  firmId: string | null;
  repId: string | null;
  revision: number;
  number: string;
  vendor: string;
  media: OrderLine['media'][];
  updatedAt: string;
  currentIssue: OrderIssue | null;
  downloaded: boolean;
  sent: boolean;
};
export type OrderEvent = {
  id: string;
  type: 'saved' | 'finalized' | 'downloaded' | 'sent' | 'sendCorrected';
  revision: number;
  issueId: string | null;
  actorId: string;
  createdAt: string;
  detail: Record<string, unknown>;
};
export type OrderDetail = OrderSummary & {
  document: OrderDocument;
  history: OrderEvent[];
  issues: OrderIssue[];
  seed: Record<string, unknown> | null;
};
export const deadlineStatuses = ['Not started', 'In progress', 'Complete', 'Not doing', 'Needs decision'] as const;
export type DeadlineStatus = typeof deadlineStatuses[number];
export type DeadlineStep = 'tv' | 'radio' | 'digital' | 'copy';
export type LegacyOrderReference = { campaignId: string; marketId: string; title?: string };
export type Deadline = {
  id: string;
  calendarId: string;
  revision: number;
  marketId: string;
  step: DeadlineStep;
  dueDate: string;
  statusOverride: DeadlineStatus | null;
  orderIds: string[];
  legacyRefs: LegacyOrderReference[];
  copySentAt: string | null;
  status: DeadlineStatus;
};
export type Calendar = {
  id: string;
  clientId: string;
  year: number;
  name: string;
  revision: number;
  deadlines: Deadline[];
};
export type OrderWorkspace = { calendars: Calendar[]; orders: OrderSummary[] };
export type OrderAction =
  'saveOrder' | 'createRevision' | 'reviseOrder' | 'restoreRevision' | 'finalizeOrder' |
  'recordDownload' | 'recordSend' | 'correctSend' | 'saveCalendar' | 'saveMarketDeadlines' |
  'saveDeadline' | 'recordCopySend';
type OrderResult<Action extends OrderAction> =
  Action extends 'saveCalendar' | 'saveMarketDeadlines' ? Calendar :
  Action extends 'saveDeadline' | 'recordCopySend' ? Deadline : OrderDetail;

const headerFields = {
  number: 100, date: 10, clientName: 250, vendor: 250, rep: 200, buyer: 200, buyerEmail: 254,
  billing: 250, terms: 2000, start: 10, end: 10, notes: 5000,
} as const;
const lineFields = {
  id: 100, marketId: 100, station: 200, program: 300, format: 200, days: 100, start: 10, end: 10, notes: 5000,
} as const;
function cleanText(value: unknown, name: string, limit: number) {
  check(typeof value === 'string' && value.length <= limit, `Enter valid ${name} text up to ${limit} characters.`);
  return value.trim();
}
export function validOrderDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function optionalDate(date: string, name: string) {
  check(!date || validOrderDate(date), `Enter a valid ${name} date.`);
}
function integer(value: unknown, name: string, maximum: number) {
  if (value === null || value === undefined) return null;
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    `Enter a nonnegative whole number for ${name}.`);
  return value;
}
function weekCount(value: unknown) {
  if (value === null || value === undefined) return null;
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 520,
    'Enter a nonnegative week count up to 520.');
  return value;
}
function cleanSource(value: unknown): OrderSource | undefined {
  if (value === undefined || value === null) return undefined;
  check(object(value), 'Choose a valid source.');
  const { kind } = value;
  check(kind === 'historical' || kind === 'broadcast' || kind === 'digital', 'Choose a valid source type.');
  const id = cleanText(value.id, 'source ID', 250);
  const label = cleanText(value.label, 'source name', 400);
  const locator = cleanText(value.locator ?? '', 'source locator', 600);
  const url = cleanText(value.url ?? '', 'source URL', 2000);
  check(!!id && !!label && (!url || /^https:\/\/[^\s]+$/i.test(url)), 'Choose a valid source reference.');
  const year = integer(value.year, 'source year', 2100);
  check(year === null || year >= 1900, 'Choose a valid source year.');
  return { kind, id, label, ...(locator && {locator}), ...(url && {url}), ...(year && {year}) };
}

export function cleanOrderDocument(raw: unknown, scope: { marketIds: string[]; workflow: OrderWorkflow }): OrderDocument {
  check(object(raw), 'Enter valid order details.');
  const header = Object.fromEntries(Object.entries(headerFields).map(([key, limit]) =>
    [key, cleanText(raw[key] ?? '', key, limit)])) as Omit<OrderDocument, 'lines'>;
  optionalDate(header.date, 'order');
  optionalDate(header.start, 'flight start');
  optionalDate(header.end, 'flight end');
  check(!header.start || !header.end || header.start <= header.end, 'The order flight ends before it starts.');
  check(Array.isArray(raw.lines) && raw.lines.length <= 200, 'Use up to 200 placements per order.');
  const ids = new Set<string>();
  const lines = raw.lines.map((line: unknown): OrderLine => {
    check(object(line), 'Enter valid placement details.');
    const fields = Object.fromEntries(Object.entries(lineFields).map(([key, limit]) =>
      [key, cleanText(line[key] ?? '', key, limit)])) as Pick<OrderLine, keyof typeof lineFields>;
    check(!!fields.id && !ids.has(fields.id), 'Placement IDs must be present and unique.');
    ids.add(fields.id);
    check(scope.marketIds.includes(fields.marketId), 'A placement market must be assigned to the order.');
    const { media } = line;
    check(media === 'TV' || media === 'Radio' || media === 'Digital', 'Choose a placement medium.');
    check(scope.workflow !== 'digital' || media === 'Digital', 'Digital orders can contain only digital placements.');
    optionalDate(fields.start, 'placement start');
    optionalDate(fields.end, 'placement end');
    const start = fields.start || header.start;
    const end = fields.end || header.end;
    check(!start || !end || start <= end, 'A placement ends before it starts.');
    check(line.noCharge === undefined || typeof line.noCharge === 'boolean', 'Choose a valid no-charge value.');
    const rate = integer(line.rate, 'placement rate in cents', 100_000_000_000);
    const quantity = integer(line.quantity, 'placement quantity', 1_000_000_000);
    const amount = integer(line.amount, 'placement amount in cents', 100_000_000_000);
    const impressions = integer(line.impressions, 'placement impressions', 1_000_000_000);
    const source = cleanSource(line.source);
    const placement = {
      ...fields, media, rate, quantity, amount, impressions, noCharge: line.noCharge === true,
      ...(line.priorFlight !== undefined && {priorFlight: cleanText(line.priorFlight, 'prior flight', 200)}),
      ...(line.weeks !== undefined && {weeks: weekCount(line.weeks)}),
      ...(line.spotsPerDay !== undefined && {spotsPerDay: integer(line.spotsPerDay, 'spots per day', 10000)}),
      ...(line.spotsPerWeek !== undefined && {spotsPerWeek: integer(line.spotsPerWeek, 'spots per week', 100000)}),
      ...(line.audience !== undefined && {audience: integer(line.audience, 'audience', 1_000_000_000)}),
      ...(line.cpm !== undefined && {cpm: integer(line.cpm, 'CPM in cents', 100_000_000_000)}),
      ...(source && {source})
    };
    check((orderLineAmount(placement) ?? 0) <= 100_000_000_000, 'Placement amount exceeds the supported maximum.');
    return placement;
  });
  return { ...header, lines };
}

export function orderLineAmount(line: OrderLine) {
  if (line.noCharge) return 0;
  if (line.amount !== null) return line.amount;
  return line.rate !== null && line.quantity !== null ? line.rate * line.quantity : null;
}
export function orderTotal(document: OrderDocument) {
  return document.lines.reduce((total, line) => total + (orderLineAmount(line) ?? 0), 0);
}
export function validateOrderForIssue(document: OrderDocument) {
  check(!!document.number && !!document.date && !!document.clientName && !!document.vendor,
    'Enter an order number, order date, client, and vendor before finalizing.');
  check(!!document.buyer && /^\S+@\S+\.\S+$/.test(document.buyerEmail) && !!document.billing && !!document.terms,
    'Enter buyer and billing contacts and the order terms before finalizing.');
  check(document.lines.length > 0, 'Add at least one placement before finalizing.');
  for (const line of document.lines) {
    check(!!line.program || !!line.station, 'Enter a station or placement name on every line.');
    check(!!(line.start || document.start) && !!(line.end || document.end), 'Enter flight dates for every placement.');
    check(orderLineAmount(line) !== null, 'Price every placement or mark it no charge before finalizing.');
  }
}
function rpcFailure(error: {code?: string; message: string}): never {
  if (['PT409', '40001', '23505'].includes(error.code ?? '')) {
    throw new Conflict('This record changed in another window. Reload before saving.');
  }
  if (error.code === 'PT404') throw new AccessError('This order or deadline is unavailable.', 404);
  if (error.code === '42501') throw new AccessError('You do not have access to Orders.', 403);
  if (error.code === 'PT400') throw new InputError(error.message);
  if (error.code === '22P02' || error.code === '22007' || error.code === '22008' || error.code === '23514') {
    throw new InputError('Enter valid order or calendar details.');
  }
  throw new StorageError('Orders storage is unavailable. Try again.');
}

export function orderStore(db: Pick<SupabaseClient, 'rpc'>) {
  async function rpc<Result>(name: string, parameters: Record<string, unknown>): Promise<Result> {
    const {data, error} = await db.rpc(name, parameters);
    if (error) rpcFailure(error);
    return data as Result;
  }
  return {
    readWorkspace(clientId: string, year: number) {
      return rpc<OrderWorkspace>('ff_orders_workspace', { p_client_id: clientId, p_year: year });
    },
    readOrder(id: string) {
      return rpc<OrderDetail | null>('ff_orders_detail', { p_id: id });
    },
    readCalendar(id: string) {
      return rpc<Calendar | null>('ff_order_calendar_detail', { p_id: id });
    },
    command<Action extends OrderAction>(actorId: string, action: Action, input: Record<string, unknown>) {
      return rpc<OrderResult<Action>>('ff_orders_command', { p_actor_id: actorId, p_action: action, p_input: input });
    },
  };
}
