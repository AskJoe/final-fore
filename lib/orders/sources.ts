import { CHANNEL_CATALOG, MARKETS, TEMPLATE } from '../domain/catalogs';
import { channelPlan } from '../domain/campaigns';
import type { Directory } from '../domain/directory';
import { InputError } from '../domain/types';
import { cellText, measurementValue, radioFields, type Entry, type ViewQuery, type WorkbookView } from '../broadcast/view';
import { calculateRadioCpm, type CellValue, type SheetName } from '../broadcast/workbook';
import { StorageError } from '../store';
import marketLinks from '../../data/research-market-links.json';
import assignmentEvidence from '../../data/research-assignment-seed.json';
import { type ArchiveFile, type ArchiveLine, type ArchiveRecord, type ArchiveReferenceRole, type OrderArchive, type SourceRef } from './archive-source';
import type { OrderDocument, OrderLine, OrderSource, OrderWorkflow } from './store';

export { loadOrderArchive, type OrderArchive, type SourceRef } from './archive-source';

type Media = OrderLine['media'];
type Scope = { clientId: string; year: number };
type ArchiveQuery = {
  clientId: string; year?: number; marketId?: string; media?: string; q?: string; page?: number;
  rep?: string; firm?: string; workflow?: string; sort?: string;
};
export type ResearchQuery = Scope & {
  marketId: string; workflow: OrderWorkflow; sheet: string; page?: number; q?: string;
  rep?: string; firm?: string; primary?: string; secondary?: string; sort?: string;
  allocation?: number | null;
  quotesOnly?: boolean;
};
export type DigitalDraftValues = Pick<OrderLine, 'amount' | 'impressions' | 'cpm'>;
export type ResearchRow = {
  id: string; marketId: string; market: string; program: string; firm: string; rep: string;
  cells: CellValue[]; source: SourceRef | null; line: OrderLine | null;
  digitalDraftValues?: DigitalDraftValues;
  periods?: { label: string; line: OrderLine; source: SourceRef }[];
};

export type OrderOpportunity = Scope & {
  key: string; workflow: OrderWorkflow; marketId: string; marketIds: string[]; title: string;
  firmId: string | null; repId: string | null; firm: string; rep: string; media: Media[];
  archiveId: string | null; seedAvailable: boolean; basis: string[];
};

const digitalSeeds = new Set(['23', '18', '218', '228', '220', '200']);
const digitalVendorOriginals = new Set(['24', '19', '217', '221', '201']);
const normalize = (text: string) => text.trim().toLowerCase();
const names = new Map<string, string[]>();
for (const market of Object.values(MARKETS)) {
  const name = normalize(market.name);
  names.set(name, [...(names.get(name) ?? []), market.id]);
}
const reviewedNames = new Map(marketLinks.filter(item => item.marketId && !item.needsLink)
  .map(item => [normalize(item.label), item.marketId!]));
const displayMarket = (id: string) => String(MARKETS[id]?.name ?? id);
const marketAliases: Record<string, string> = {
  'ft. smith-fayetteville-springdale-rogers': 'epic3-arkansas-nwa',
  'ft. smith-fay-sprngdl-rgrs': 'epic3-arkansas-nwa',
  'fayetteville, ar': 'epic3-arkansas-nwa',
  'denver-boulder': 'epic3-denver', 'chicago': 'epic3-chicagoland',
  'cedar rapids-waterloo-dubuque': 'epic3-iowa-city-cedar-rapids',
  'davenport-rock island-moline': 'epic3-davenport', 'milwaukee': 'epic3-milwaukee-racine-kenosha',
  'salt lake city': 'epic3-salt-lake-ogden', 'lincoln-hastings-kearney': 'epic3-lincoln',
  'dallas-ft. worth': 'epic3-dallas-fort-worth-weatherford', 'green bay-appleton': 'epic3-green-bay-appleton',
  'fresno-visalia': 'epic3-hill-fresno-ca', 'lexington': 'epic3-hill-lexington-ky',
  'tampa-st. petersburg': 'epic3-hill-tampa', 'minneapolis-st.paul': 'steve-minneapolis',
};
function marketIdsFor(label: string) {
  if (Object.hasOwn(MARKETS, label)) return [label];
  const normalized = normalize(label);
  const reviewed = reviewedNames.get(normalized);
  if (reviewed) return [reviewed];
  const alias = Object.hasOwn(marketAliases, normalized) ? marketAliases[normalized] : undefined;
  return alias ? [alias] : names.get(normalized) ?? [];
}
function marketIdFor(label: string) {
  const matches = marketIdsFor(label);
  return matches.length === 1 ? matches[0] : undefined;
}

function selectedClient(directory: Directory, clientId: string) {
  const client = directory.clients.find(candidate => candidate.id === clientId);
  if (!client) throw new InputError('Choose a client from Clients.');
  return client;
}
function selectedMarket(directory: Directory, clientId: string, marketId: string) {
  const client = selectedClient(directory, clientId);
  if (!client.marketIds.includes(marketId) || !Object.hasOwn(MARKETS, marketId)) {
    throw new InputError('Choose a market assigned to this client.');
  }
  return client;
}

function number(value: string | number | null | undefined) {
  const text = String(value ?? '').replace(/[$,]/g, '').trim();
  return /^\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
function cents(value: string | number | null | undefined) {
  const amount = number(value);
  return amount === null ? null : Math.round((amount + Number.EPSILON) * 100);
}
function count(value: string | number | null | undefined) {
  const parsed = number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function medium(value: string): Media | null {
  if (value === 'TV' || value === 'broadcast-tv') return 'TV';
  if (value === 'Radio' || value === 'broadcast-radio') return 'Radio';
  return value === 'Digital' || value === 'digital' ? 'Digital' : null;
}
const mediaArray = (items: string[]) => [...new Set(items.map(medium).filter((value): value is Media => value !== null))];
const knownDigital = (order: ArchiveRecord) => digitalSeeds.has(order.source) || digitalVendorOriginals.has(order.source);
const workflowFor = (order: ArchiveRecord) => knownDigital(order) ? 'digital' as const : 'broadcast' as const;
const orderMarket = (archive: OrderArchive, label: string) => marketIdFor(label) ?? archive.marketIds[label];
const archiveTitle = (order: ArchiveRecord) => order.source === '200' ? 'EPIC3 Weather V6' :
  digitalSeeds.has(order.source) ? order.market.split(',')[0] + ' digital' : order.name;

function sourceRef(file: ArchiveFile, shareable = true): SourceRef {
  return {
    kind: ['Signed order','Signed publisher plan'].includes(file.kind) ? 'signed-order' : 'historical-order',
    id: file.id, title: file.name, ...(shareable && {url: file.url}), version: file.revision, signedOn: file.signedOn,
  };
}
function lineSource(ref: SourceRef, year: number): OrderSource {
  const kind = ref.kind === 'digital-catalog' ? 'digital' : ref.kind === 'broadcast-research' ? 'broadcast' : 'historical';
  return { kind, id: ref.id, label: ref.title, year,
    ...(ref.url && { url: ref.url }),
    ...((ref.locator || ref.priorFlight) && { locator: [ref.locator, ref.priorFlight && 'Prior flight ' + ref.priorFlight].filter(Boolean).join(' · ') }),
  };
}

function sourceMatchesClient(label: string, clientId: string, owned: string[]) {
  const name = normalize(label);
  if (name.includes('epic3')) return clientId === 'epic3';
  return name.includes('steve') && owned.includes('steve-minneapolis');
}
function archiveScope(archive: OrderArchive, record: ArchiveRecord, clientId: string, owned: string[]) {
  const sourceMarket = orderMarket(archive, record.market);
  const referenceMarkets = record.targets.map(target => orderMarket(archive, target));
  const matchesClient = (lineClient = '') => sourceMatchesClient(lineClient || record.client, clientId, owned);
  const declared = matchesClient();
  const lines = record.lines.flatMap((line, index) => {
    const marketId = line.target ? orderMarket(archive, line.target) : sourceMarket;
    if (!marketId || !owned.includes(marketId) || !matchesClient(line.client)) return [];
    return [{ line, index, marketId }];
  });
  const marketIds = [...new Set([...lines.map(line => line.marketId),
    ...(declared ? [sourceMarket, ...referenceMarkets].filter(id => id && owned.includes(id)) : [])])];
  return { marketIds, lines, entire: declared && lines.length === record.lines.length &&
    referenceMarkets.every(id => owned.includes(id)),
    sharedAcrossClients: !declared || record.lines.some(line => !matchesClient(line.client)) };
}

function canSeed(archive: OrderArchive, record: ArchiveRecord, scope: ReturnType<typeof archiveScope>) {
  if (!scope.entire || !scope.marketIds.length || record.signed !== record.source ||
      archive.files[record.source].kind !== 'Signed order' ||
      !(digitalSeeds.has(record.source) || !knownDigital(record) && record.type === 'Vendor order' && scope.marketIds.length === 1)) return false;
  const paid = scope.lines.filter(({line}) => line.kind === 'Placement' && line.context !== 'Trade');
  const amount = cents(record.amount);
  return !!paid.length && amount !== null && paid.every(({line}) => !!medium(line.medium) &&
    (cents(line.amount) !== null || /bonus/i.test(line.placement))) &&
    paid.reduce((total, {line}) => total + (cents(line.amount) ?? 0), 0) === amount;
}

function archivePlacement(ref: SourceRef, archive: OrderArchive, order: ArchiveRecord,
    {line, marketId, index}: ReturnType<typeof archiveScope>['lines'][number]) {
  const source = { ...ref, locator: line.tab + ' · row ' + line.row, priorFlight: line.flight, orderNumber: order.ref };
  return {
    id: order.id + '-' + line.row + '-' + index, marketId, market: displayMarket(marketId), media: line.medium,
    station: line.station, program: line.placement, format: line.fmt, days: line.days, flight: line.flight,
    rate: cents(line.rate), quantity: count(line.spots), amount: cents(line.amount), impressions: count(line.impressions),
    impressionsText: line.impressions, kind: line.kind, notes: [line.description, line.note, line.context].filter(Boolean).join(' · '),
    source, weeks: line.weeks, spotsPerDay: line.perDay ?? '', spotsPerWeek: line.weekly ?? '',
    audience: line.aud ?? '', cpm: line.cpm ?? '', netMedia: cents(line.net), fee: line.fee ?? '', area: line.area,
    referenceYear: archive.year,
  };
}
type ArchivePlacement = ReturnType<typeof archivePlacement>;

function draftPlacement(item: ArchivePlacement): OrderLine | null {
  const media = medium(item.media);
  if (!media || item.kind !== 'Placement') return null;
  // Keep the prior flight on the source. A new issue needs an explicitly selected flight.
  const amount = item.rate !== null && item.quantity !== null && item.rate * item.quantity === item.amount
    ? null : item.amount;
  const audienceInThousands = number(item.audience);
  return { id: 'archive-' + item.id, marketId: item.marketId, media, station: item.station, program: item.program,
    format: item.format, days: item.days, start: '', end: '', rate: item.rate, quantity: item.quantity, amount,
    impressions: item.impressions, noCharge: item.amount === null && /bonus/i.test(item.program),
    notes: [item.notes, item.impressionsText === 'TBD' ? 'Prior impressions TBD' : ''].filter(Boolean).join(' · '),
    priorFlight: item.flight, weeks: number(item.weeks),
    spotsPerDay: count(item.spotsPerDay.replace(/(?: spots?)? per day$/i, '')),
    spotsPerWeek: count(item.spotsPerWeek),
    audience: audienceInThousands === null ? null : Math.round(audienceInThousands * 1000), cpm: cents(item.cpm),
    source: lineSource(item.source, item.referenceYear),
  };
}

function paginate<T>(rows: T[], requested?: number, size = 30) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Number.isSafeInteger(requested) && requested! > 0 ? Math.min(requested!, pageCount) : 1;
  return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageCount };
}
const contains = (haystack: (string | number | undefined)[], query?: string) => !query ||
  normalize(haystack.filter(value => value !== undefined).join(' ')).includes(normalize(query));

export function searchOrderArchive(archive: OrderArchive | null, directory: Directory, query: ArchiveQuery) {
  const client = query.marketId ? selectedMarket(directory, query.clientId, query.marketId) : selectedClient(directory, query.clientId);
  const records: (ArchiveRecord & { referenceRole?: ArchiveReferenceRole })[] = archive
    ? [...archive.orders, ...(archive.references ?? [])] : [];
  const orders = !archive || query.year !== undefined && query.year !== archive.year ? [] : records.flatMap(record => {
    const scope = archiveScope(archive, record, query.clientId, client.marketIds);
    if (!scope.marketIds.length || query.marketId && !scope.marketIds.includes(query.marketId)) return [];
    const file = archive.files[record.source], workflow = workflowFor(record);
    if (query.workflow && query.workflow !== workflow ||
        query.rep && normalize(file.rep) !== normalize(query.rep) ||
        query.firm && normalize(file.firm) !== normalize(query.firm)) return [];
    const scoped = scope.lines.filter(({line, marketId}) => (!query.marketId || marketId === query.marketId) &&
      (!query.media || query.media === 'all' || normalize(line.medium) === normalize(query.media)));
    const media = mediaArray(scoped.map(({line}) => line.medium));
    if (query.media && query.media !== 'all' && !scoped.length ||
        !contains([record.name, record.ref, record.market, file.rep, file.firm,
          ...scoped.flatMap(({line}) => [line.station, line.placement])], query.q)) return [];
    const latest = sourceRef(file, !scope.sharedAcrossClients);
    return [{
      id: record.id, title: archiveTitle(record), orderNumber: record.ref, orderDate: record.issued,
      clientId: query.clientId, year: archive.year, marketIds: scope.marketIds, market: record.market,
      workflow, media, firm: file.firm, rep: file.rep, amount: scope.entire ? cents(record.amount) : null,
      amountBasis: scope.entire ? record.basis : '', impressions: scope.entire ? count(record.imps) : null,
      referenceRole: record.referenceRole, note: scope.sharedAcrossClients ? 'Only the placements assigned to this client are shown.' : record.note,
      lines: scoped.map(line => archivePlacement(latest, archive, record, line)),
      latest, signed: record.signed ? sourceRef(archive.files[record.signed], !scope.sharedAcrossClients) : null,
      related: scope.sharedAcrossClients ? [] : record.related.map(id => sourceRef(archive.files[id])),
      seedAvailable: !record.referenceRole && canSeed(archive, record, scope), billing: scope.entire ? archive.billing?.[record.id] ?? null : null,
    }];
  });
  if (query.sort === 'amount') orders.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  else if (query.sort === 'title') orders.sort((a, b) => a.title.localeCompare(b.title));
  const {rows, ...page} = paginate(orders, query.page, 20);
  return {orders: rows, ...page, availability: archive ? 'available' as const : 'unconfigured' as const };
}

const firmAliases: Record<string, string> = {
  'iheart': 'iheartmedia', 'iheart radio': 'iheartmedia', 'gray tv': 'gray',
  'cbs corp.': 'cbs corp', 'fox corp.': 'fox corp',
};
const normalizedFirm = (firm: string) => firmAliases[normalize(firm)] ?? normalize(firm);

export function orderOpportunities(archive: OrderArchive | null, directory: Directory, scope: Scope): OrderOpportunity[] {
  const client = selectedClient(directory, scope.clientId);
  const opportunities = new Map<string, OrderOpportunity>();
  const activeFirms = directory.firms.filter(firm => firm.active);
  const activeReps = directory.reps.filter(rep => rep.active);
  const owned = client.marketIds.filter((id: string) => Object.hasOwn(MARKETS, id));
  function add(marketIds: string[], media: Media[], firmName: string, repName: string, basis: string,
    archiveId: string | null = null, seedAvailable = false, title?: string, workflow: OrderWorkflow = 'broadcast') {
    const [marketId] = marketIds;
    if (!marketId || !marketIds.every(id => owned.includes(id))) return;
    const firm = activeFirms.find(candidate => normalizedFirm(candidate.name) === normalizedFirm(firmName));
    const rep = firm && activeReps.find(candidate => candidate.firmId === firm.id && normalize(candidate.name) === normalize(repName));
    const key = workflow + '|' + scope.clientId + '|' + scope.year + '|' + (
      workflow === 'digital' && marketIds.length === 1 ? marketId : archiveId ? 'archive|' + archiveId :
        [marketId, firm?.id || normalizedFirm(firmName), rep?.id || normalize(repName)].join('|')
    );
    const previous = opportunities.get(key);
    if (previous) {
      previous.media = [...new Set([...previous.media, ...media])];
      if (!previous.basis.includes(basis)) previous.basis.push(basis);
      return;
    }
    opportunities.set(key, { ...scope, key, workflow, marketId, marketIds, title: title || [repName, firmName].filter(Boolean).join(' · ') || displayMarket(marketId),
      firmId: firm?.id ?? null, repId: rep?.id ?? null, firm: firm?.name ?? firmName, rep: rep?.name ?? repName,
      media, archiveId, seedAvailable, basis: [basis],
    });
  }
  for (const rep of activeReps) {
    const firm = activeFirms.find(candidate => candidate.id === rep.firmId);
    if (!firm) continue;
    for (const item of rep.coverage ?? []) {
      const station = directory.stations.find(candidate => candidate.id === item.stationId && candidate.active);
      const market = marketIdFor(item.market || station?.market || '');
      const media = medium(item.mediaType);
      if (market && media && media !== 'Digital') add([market], [media], firm.name, rep.name, 'Directory contact');
    }
    for (const assignment of assignmentEvidence) {
      if (assignment.status !== 'confirmed' || assignment.sourceInactive || assignment.repId !== rep.id ||
          assignment.firmId !== firm.id || normalize(assignment.email) !== normalize(rep.email)) continue;
      const media = mediaArray((rep.coverage ?? []).map((item: {mediaType: string}) => item.mediaType)).filter(value => value !== 'Digital');
      if (media.length) for (const market of assignment.marketIds) add([market], media, firm.name, rep.name, 'Confirmed coverage');
    }
  }
  if (archive?.coverageYear === scope.year) for (const item of archive.coverage) {
    if (item.clientId !== scope.clientId) continue;
    const firm = activeFirms.find(candidate => normalizedFirm(candidate.name) === normalizedFirm(item.firm));
    const rep = firm && activeReps.find(candidate => candidate.firmId === firm.id && normalize(candidate.name) === normalize(item.rep));
    const media = mediaArray(item.media).filter(value => value !== 'Digital');
    if (rep && firm && media.length) for (const label of item.evidence) add([item.marketId], media, firm.name, rep.name, label);
  }
  if (archive) for (const record of archive.orders) {
    if (workflowFor(record) === 'digital' ? !digitalSeeds.has(record.source) : record.type !== 'Vendor order') continue;
    const historical = archiveScope(archive, record, scope.clientId, owned);
    if (!historical.entire || !historical.marketIds.length || scope.year <= archive.year) continue;
    const file = archive.files[record.source];
    const workflow = workflowFor(record), seedAvailable = canSeed(archive, record, historical);
    if (workflow === 'digital' && !seedAvailable) continue;
    add(historical.marketIds, mediaArray(historical.lines.map(item => item.line.medium)),
      workflow === 'digital' ? '' : file.firm, workflow === 'digital' ? '' : file.rep,
      seedAvailable ? 'Signed ' + archive.year + ' order' : 'Archived ' + archive.year + ' order',
      record.id, seedAvailable, archiveTitle(record), workflow);
  }
  for (const marketId of owned) add([marketId], ['Digital'], '', '', 'Client market', null, false, displayMarket(marketId) + ' digital', 'digital');
  for (const station of directory.stations) {
    if (!station.active) continue;
    const market = marketIdFor(station.market), media = medium(station.mediaType);
    const firm = activeFirms.find(candidate => candidate.id === (station.repFirmId || station.ownerFirmId));
    if (market && media && media !== 'Digital' && firm &&
        ![...opportunities.values()].some(item => item.marketId === market && item.firmId === firm.id && item.media.includes(media))) {
      add([market], [media], firm.name, '', 'Station directory');
    }
  }
  return [...opportunities.values()].sort((a, b) =>
    displayMarket(a.marketId).localeCompare(displayMarket(b.marketId)) || a.title.localeCompare(b.title));
}

export function archiveOrderSeed(archive: OrderArchive | null, directory: Directory,
  scope: Scope & { archiveId: string; workflow: OrderWorkflow; marketIds: string[] }) {
  const client = selectedClient(directory, scope.clientId);
  for (const market of scope.marketIds) selectedMarket(directory, scope.clientId, market);
  const record = archive?.orders.find(order => order.id === String(scope.archiveId));
  if (!archive || !record || scope.year <= archive.year || workflowFor(record) !== scope.workflow) {
    throw new InputError('That signed order is unavailable for this draft.');
  }
  const historical = archiveScope(archive, record, scope.clientId, client.marketIds);
  if (!canSeed(archive, record, historical) || scope.marketIds.length !== historical.marketIds.length ||
      !historical.marketIds.every(id => scope.marketIds.includes(id))) {
    throw new InputError('Choose a signed order for the exact client and market scope.');
  }
  const file = archive.files[record.source];
  const source = { ...sourceRef(file), orderNumber: record.ref, year: archive.year,
    title: file.name, related: record.related.map(id => sourceRef(archive.files[id])),
    billing: archive.billing?.[record.id] ?? null };
  const lines = historical.lines.filter(({line}) => line.context !== 'Trade')
    .map(line => draftPlacement(archivePlacement(sourceRef(file), archive, record, line))).filter(line => line !== null);
  const header: Omit<OrderDocument, 'lines'> = {
    number: '', date: '', clientName: client.name, vendor: record.type.includes('vendor') || record.type === 'Vendor order' ? file.firm : '',
    rep: file.rep, buyer: TEMPLATE.contact || '', buyerEmail: TEMPLATE.email || '', billing: '',
    terms: TEMPLATE.terms || '', start: '', end: '', notes: '',
  };
  return { header, lines, source };
}

const columns = (labels: string[]) => labels.map(label => ({label}));
function moneyCell(value: number | null | undefined, locator: string): CellValue {
  return value == null ? null : { value: value / 100, unit: 'USD', locator, raw: String(value / 100) };
}
function countCell(value: number | null | undefined, locator: string): CellValue {
  return value == null ? null : { value, unit: 'impressions', locator, raw: String(value) };
}
type DigitalHistoryLine = { media: number; fee: number; impressions: number | null; sources: string[] };
function digitalHistoryCells(history: DigitalHistoryLine | undefined,
  workbook: OrderArchive['digitalResearch']): CellValue[] {
  if (!history) return [null, null, null, null, null, null];
  const evidence = history.sources.flatMap(cell => {
    const fact = workbook?.history[cell];
    return fact ? [{ cell, ...fact }] : [];
  });
  const bonus = evidence.reduce((sum, fact) => sum + (fact.bonus ?? 0), 0);
  const hasActivity = history.media > 0 || history.fee > 0 || (history.impressions ?? 0) > 0 || bonus > 0;
  if (!hasActivity) return [null, null, null, null, null, null];
  const paidCells = history.sources.join(', ');
  const shares = evidence.filter(fact => fact.share);
  return [
    history.media > 0 ? moneyCell(history.media, paidCells) : null,
    history.fee > 0 ? moneyCell(history.fee, paidCells) : null,
    history.media + history.fee > 0 ? moneyCell(history.media + history.fee, paidCells) : null,
    countCell(history.impressions, evidence.map(fact => fact.impressionsCell).join(', ')),
    shares.length === 1 ? shares[0].share! : shares.map(fact => `${fact.share} (${fact.cell})`).join(' · '),
    bonus > 0 ? countCell(bonus, evidence.flatMap(fact => fact.bonusCell ?? []).join(', ')) : null,
  ];
}

const digitalHistoryColumns = (year: number) =>
  ['media', 'fee', 'gross', 'impressions', 'spend share', 'bonus impressions'].map(label => `${year} ${label}`);
const researchSorts = new Set(['title', 'program', 'amount', 'impressions']);
const groupLabels: Record<string, string> = {market:'Market', client:'Client', rep:'Rep', firm:'Firm'};
function groupField(value?: string) {
  const key = normalize(value ?? '');
  return Object.hasOwn(groupLabels,key) ? groupLabels[key] : value ?? '';
}
function groupValue(row: ResearchRow, field?: string) {
  const name = normalize(field ?? '');
  if (name === 'market') return row.market;
  if (name === 'rep') return row.rep;
  if (name === 'firm') return row.firm;
  return '';
}
function orderResearchRows(rows: ResearchRow[], labels: {label:string}[], query: ResearchQuery) {
  const measure = (row: ResearchRow, field: 'amount' | 'impressions') => {
    const patterns = field === 'amount' ? [/ allocated$/i,/^placement amount$/i,/ gross$/i,/^spot rate$/i] :
      [/ est\. impressions$/i,/^gross impressions$/i,/^impressions$/i,/^\d{4} impressions$/i];
    for (const pattern of patterns) {
      const index = labels.findIndex(column => pattern.test(column.label));
      const value = measurementValue(row.cells[index]);
      if (value !== null) return value;
    }
    if (field === 'impressions') return row.line?.impressions ?? -1;
    const cents = row.line?.amount ?? row.line?.rate ?? row.periods?.[0]?.line.rate;
    return cents == null ? -1 : cents / 100;
  };
  rows.sort((a,b) => {
    const primary = groupValue(a,query.primary).localeCompare(groupValue(b,query.primary));
    const secondary = groupValue(a,query.secondary).localeCompare(groupValue(b,query.secondary));
    if (primary || secondary) return primary || secondary;
    if (query.sort === 'title' || query.sort === 'program') return a.program.localeCompare(b.program);
    if (query.sort === 'amount' || query.sort === 'impressions') return measure(b,query.sort) - measure(a,query.sort);
    return 0;
  });
}
function finishResearch(labels: {label: string}[], records: ResearchRow[], query: ResearchQuery, available: boolean) {
  const firms = [...new Set(records.map(row => row.firm).filter(Boolean))].sort();
  const reps = [...new Set(records.map(row => row.rep).filter(Boolean))].sort();
  const visible = records.filter(row => (!query.rep || normalize(row.rep) === normalize(query.rep)) &&
    (!query.firm || normalizedFirm(row.firm) === normalizedFirm(query.firm)) &&
    contains([row.program, row.market, row.firm, row.rep, ...row.cells.map(cellText), row.source?.title], query.q));
  orderResearchRows(visible, labels, query);
  return { columns: labels, ...paginate(visible, query.page), filterOptions: {rep: reps, firm: firms},
    availability: available ? 'available' as const : 'unconfigured' as const };
}
function emptyResearchLine(id: string, marketId: string, media: Media, program: string, ref: SourceRef, year: number): OrderLine {
  return { id, marketId, media, program, station: '', format: '', days: '', start: '', end: '',
    rate: null, quantity: null, amount: null, impressions: null, noCharge: false, notes: '',
    source: lineSource(ref, year) };
}

export function orderResearch(archive: OrderArchive | null, directory: Directory, query: ResearchQuery) {
  selectedMarket(directory, query.clientId, query.marketId);
  const market = displayMarket(query.marketId);
  if (query.sheet === 'digital' && query.workflow === 'digital') {
    const referenceYear = query.year - 1;
    const digitalWorkbook = archive?.digitalResearch;
    const history = query.clientId === 'epic3' ? CHANNEL_CATALOG.markets[query.marketId] : null;
    const historyYears = Object.keys(history ?? {}).map(Number).filter(year => year < query.year).sort((a, b) => b - a);
    const earlierYears = historyYears.filter(year => year < referenceYear);
    const latestColumns = digitalHistoryColumns(referenceYear);
    const columnsForYear = columns(['Channel', query.year + ' allocated', query.year + ' fee', query.year + ' est. impressions',
      ...latestColumns.slice(0, 4), 'Planning CPM', 'Workbook CPM range', ...latestColumns.slice(4),
      ...earlierYears.flatMap(digitalHistoryColumns)]);
    if (!history) return finishResearch(columnsForYear, [], query, true);
    const plan = new Map<string, Record<string, unknown>>(channelPlan(query.marketId, query.year, query.allocation ?? null, {}).rows
      .map((row: Record<string, unknown>) => [row.id as string, row]));
    const rows: ResearchRow[] = CHANNEL_CATALOG.channels.filter((item: {kind:string}) => item.kind === 'digital')
      .map((channel: {id:string; name:string; cpm:number | null; rateSource?:string}) => {
        const latest = digitalHistoryCells(history[String(referenceYear)]?.lines?.[channel.id], digitalWorkbook);
        const earlier = earlierYears.flatMap(year => digitalHistoryCells(history[year]?.lines?.[channel.id], digitalWorkbook));
        const range = digitalWorkbook?.rates[channel.id];
        const rateSource = channel.rateSource ?? (range ? '2026 CPMs · ' + range.cell : '');
        const item = plan.get(channel.id);
        const plannedGross = count(typeof item?.allocation === 'number' ? item.allocation : null);
        const plannedMedia = count(typeof item?.media === 'number' ? item.media : null);
        const plannedImpressions = count(typeof item?.impressions === 'number' ? item.impressions : null);
        const plannedCpm = cents(typeof item?.cpm === 'number' ? item.cpm : channel.cpm);
        const historicalYear = historyYears.find(year => history[year]?.lines?.[channel.id]?.media > 0);
        const historicalLine = historicalYear === undefined ? null : history[historicalYear].lines[channel.id];
        const usePlan = plannedMedia !== null && plannedMedia > 0;
        const basisYear = usePlan ? query.year : historicalYear ?? referenceYear;
        const digitalDraftValues: DigitalDraftValues = {
          amount: usePlan ? plannedMedia : count(historicalLine?.media),
          impressions: usePlan ? plannedImpressions : count(historicalLine?.impressions) || null,
          cpm: plannedCpm,
        };
        const id = 'digital-catalog|' + query.marketId + '|' + channel.id;
        const source: SourceRef = { kind: 'digital-catalog', id, title: CHANNEL_CATALOG.sourceFile,
          url: CHANNEL_CATALOG.sourceUrl, locator: [rateSource,
            usePlan ? query.year + ' allocation' : historicalLine && basisYear + ' media · ' + historicalLine.sources.join(', '),
          ].filter(Boolean).join(' · ') };
        return { id, marketId: query.marketId, market, program: channel.name, rep: '', firm: '', source,
          cells: [channel.name, moneyCell(plannedGross, ''), moneyCell(typeof item?.fee === 'number' ? item.fee : null, ''),
            countCell(plannedImpressions, ''), ...latest.slice(0, 4),
            moneyCell(plannedCpm, rateSource), range?.display ?? null, ...latest.slice(4), ...earlier],
          line: emptyResearchLine(id, query.marketId, 'Digital', channel.name, source, basisYear),
          digitalDraftValues,
        };
      });
    return finishResearch(columnsForYear, rows, query, true);
  }
  if (['station-history','digital-history'].includes(query.sheet) && query.workflow === 'broadcast') {
    const rows: ResearchRow[] = [];
    if (archive && archive.year < query.year) {
      for (const order of archive.orders) {
        if (knownDigital(order) || !order.type.toLowerCase().includes('vendor')) continue;
        const file = archive.files[order.source];
        const scope = archiveScope(archive, order, query.clientId, [query.marketId]);
        for (const item of scope.lines) {
          if (item.marketId !== query.marketId || item.line.medium !== 'Digital' || item.line.kind !== 'Placement' ||
              item.line.context === 'Trade') continue;
          const placement = archivePlacement(sourceRef(file, !scope.sharedAcrossClients), archive, order, item);
          rows.push({ id: placement.id, marketId: query.marketId, market, program: placement.program,
            rep: file.rep, firm: file.firm, source: placement.source, line: draftPlacement(placement),
            cells: [placement.program, placement.flight, placement.format, moneyCell(placement.amount, placement.source.locator),
              countCell(placement.impressions, placement.source.locator) ?? placement.impressionsText, placement.days] });
        }
      }
    }
    return finishResearch(columns(['Channel','Prior flight','Format','Placement amount','Impressions','Run days']), rows, query, !!archive);
  }
  throw new InputError('Choose research that matches this order workflow.');
}

type RatePeriod = { start: string; through: string; rate: {value: number | null; locator: string}; cpm?: CellValue };
type PublishedRow = Entry['row'] & { avail?: boolean; pricePeriods?: RatePeriod[] };
type WorkbookLoader = (sheet: SheetName, query: ViewQuery) =>
  Promise<{ view: WorkbookView | null; reviews: {review_key:string;market_id:string}[] }>;

function exactLabels(items: string[], desired: string, compare = normalize) {
  if (!desired) return [''];
  const matches = items.filter(item => compare(item) === compare(desired));
  return matches.length ? matches : [desired];
}

export async function broadcastOrderResearch(directory: Directory, query: ResearchQuery, load: WorkbookLoader,
  radioQuoteDetails?: OrderArchive['radioQuoteDetails']) {
  const client = selectedMarket(directory, query.clientId, query.marketId);
  const name = query.sheet;
  if (query.workflow !== 'broadcast' || !['tv','radio','notes','reference','demographics'].includes(name)) {
    throw new InputError('Choose Broadcast Research for this order.');
  }
  const market = displayMarket(query.marketId);
  const [rep, firm] = [query.rep ?? '', query.firm ?? ''];
  const searchAll = query.quotesOnly || Boolean(query.q?.trim()) || researchSorts.has(query.sort ?? '');
  const viewQuery = {
    filters: { market, client: String(client.id).toUpperCase(), rep, firm },
    grouping: { primary: groupField(query.primary), secondary: groupField(query.secondary) },
    page: searchAll ? 1 : query.page ?? 1,
  };
  const first = await load(name as SheetName, viewQuery);
  const view = first.view;
  if (!view) return finishResearch([], [], query, false);
  // The workbook's exact filter uses the published label, which can differ from
  // the campaign's display name. Resolve only reviewed aliases for this market ID.
  const options = view.filterOptions;
  const markets = options.market.filter(label => marketIdsFor(label).includes(query.marketId));
  const selections = (markets.length ? markets : [market]).flatMap(label =>
    exactLabels(options.client,viewQuery.filters.client).flatMap(clientName =>
      exactLabels(options.rep,rep).flatMap(repName =>
        exactLabels(options.firm,firm,normalizedFirm).map(firmName =>
          ({market:label,client:clientName,rep:repName,firm:firmName})))));
  const combinePages = searchAll || selections.length > 1;
  const page = combinePages ? 1 : query.page ?? 1;
  const rows: ResearchRow[] = [];
  const seen = new Set<string>();
  function append(result: Awaited<ReturnType<WorkbookLoader>>, filters: ViewQuery['filters']) {
    if (!result.view) throw new StorageError('Broadcast Research changed while loading the results. Try again.');
    for (const item of broadcastResearchRows(result.view, result.reviews, {...query,market,rep:filters.rep,firm:filters.firm},radioQuoteDetails)) {
      if (!seen.has(item.id)) rows.push(item);
      seen.add(item.id);
    }
  }
  let singleView = view;
  for (const filters of selections) {
    const initial = page === viewQuery.page && Object.entries(filters).every(([key,value]) =>
      viewQuery.filters[key as keyof typeof filters] === value)
      ? first : await load(name as SheetName,{...viewQuery,filters,page});
    const available = initial.view;
    if (!available) throw new StorageError('Broadcast Research changed while loading the results. Try again.');
    singleView = available;
    append(initial,filters);
    if (!combinePages) continue;
    for (let offset = 2; offset <= available.pages; offset += 3) {
      const pages = await Promise.all(Array.from({length:Math.min(3,available.pages-offset+1)}, (_, index) =>
        load(name as SheetName, {...viewQuery,filters,page:offset+index})));
      for (const result of pages) append(result,filters);
    }
  }
  if (combinePages) orderResearchRows(rows,view.sheet.columns,query);
  return { columns:view.sheet.columns,groups:view.sheet.groups,...(combinePages ? paginate(rows,query.page) :
    {rows,total:singleView.matches,page:singleView.page,pageCount:singleView.pages}),groupOptions:view.groupFields,
    filterOptions:options,availability:'available' as const };
}

function broadcastResearchRows(view: WorkbookView, reviews: Awaited<ReturnType<WorkbookLoader>>['reviews'],
  query: ResearchQuery & {market:string;rep:string;firm:string}, radioQuoteDetails?: OrderArchive['radioQuoteDetails']) {
  const { sheet:name, market, rep, firm } = query;
  const labels = view.sheet.columns;
  const radio = name === 'radio' ? radioFields(view.sheet, name) : null;
  const spotRate = labels.findIndex(col => col.label === 'Spot rate');
  const televisionCpm = name === 'tv' ? labels.findIndex(col => col.label === 'Calculated CPM') : -1;
  const rows: ResearchRow[] = [];
  for (const entry of view.sections.flatMap(section => section.lines.flat())) {
    const row: PublishedRow = entry.row;
    const review = row.issue && reviews.find(saved => saved.review_key === row.issue?.key);
    const attribution = review ? review.market_id : row.sourceMarketId || marketIdFor(entry.market);
    if (attribution !== query.marketId || normalize(row.client) !== normalize(query.clientId)) continue;
    const file = entry.files.find(item => item.marketId === query.marketId &&
      (!rep || item.rep === rep) && (!firm || item.firm === firm));
    const source: SourceRef | null = file ? { kind: 'broadcast-research', id: file.id, title: file.name, locator: row.locator } : null;
    const cells = [...row.cells];
    const cell = (field: string) => cells[labels.findIndex(col => col.label === field)];
    const quote = cell('Spot rate');
    const supplement = name === 'radio' ? radioQuoteDetails?.[row.id] : undefined;
    const reviewed = supplement && supplement.marketId === attribution && supplement.locator === row.locator &&
      typeof quote === 'object' && quote && supplement.rateCell === quote.locator && supplement.rate === quote.value
      ? supplement : undefined;
    const cpmIndex = radio?.cpm ?? televisionCpm;
    const calculated = calculateRadioCpm(measurementValue(quote), measurementValue(cell(radio ? 'AQH (people)' : 'Audience count')));
    if (reviewed) {
      for (const [index, { label }] of labels.entries()) {
        if (Object.hasOwn(reviewed.fields, label)) cells[index] = reviewed.fields[label];
      }
    }
    if (cpmIndex >= 0 && (cells[cpmIndex] === undefined || cells[cpmIndex] === null) && calculated !== null) {
      cells[cpmIndex] = moneyCell(cents(calculated), typeof quote === 'object' && quote ? quote.locator : '');
    }
    const station = cellText(cell('Station') ?? '');
    const program = cellText(cell(name === 'radio' ? 'Daypart' : 'Program') ?? '');
    const title = program || station || cellText(row.cells[0] ?? '') || 'Workbook reference';
    const maySelect = (name === 'radio' || name === 'tv') && source && (!row.issue || review) && station && program;
    let line: OrderLine | null = null;
    let periods: ResearchRow['periods'];
    if (maySelect) {
      const quoteSource = { ...source, locator: typeof quote === 'object' && quote ? quote.locator : source.locator };
      const draft = { ...emptyResearchLine(row.id, query.marketId, name === 'radio' ? 'Radio' : 'TV', program, quoteSource, query.year),
        station, format: cellText(cell('Spot (sec)') ?? ''), days: cellText(cell('Schedule') ?? ''),
        audience: count(measurementValue(cell(name === 'radio' ? 'AQH (people)' : 'Audience count'))),
        cpm: cents(measurementValue(cell(name === 'radio' ? 'CPM' : 'Reported CPM')) ?? calculated) };
      if (row.pricePeriods?.length) {
        periods = row.pricePeriods.flatMap(period => {
          const rate = cents(period.rate.value);
          if (rate === null || !/^\d{4}-\d{2}-\d{2}$/.test(period.start) ||
              !/^\d{4}-\d{2}-\d{2}$/.test(period.through) || period.start > period.through ||
              Number(period.start.slice(0,4)) !== query.year || Number(period.through.slice(0,4)) !== query.year) return [];
          const periodSource = { ...source, locator: period.rate.locator || source.locator };
          return [{ label: period.start + ' – ' + period.through + ' · ' + cellText(moneyCell(rate, period.rate.locator)),
            source: periodSource, line: { ...draft, start: period.start, end: period.through, rate,
              cpm: cents(measurementValue(period.cpm)) ??
                cents(calculateRadioCpm(period.rate.value, draft.audience ?? null)) ?? draft.cpm,
              source: lineSource(periodSource, query.year) } }];
        });
      } else if (reviewed?.year === query.year || row.avail && query.year === 2027) {
        line = { ...draft, rate: cents(measurementValue(quote)) };
      } else {
        // A station schedule can be copied without applying an unverified current rate.
        line = draft;
      }
    }
    if (periods?.length) {
      for (const [index, key] of [[spotRate, 'rate'], [televisionCpm, 'cpm']] as const) {
        if (index < 0 || cells[index] != null && cells[index] !== '') continue;
        const amounts = periods.flatMap(({ line }) => {
          const rate = line.rate;
          if (rate === null || rate === undefined) return [];
          return key === 'rate' ? [rate] : cents(calculateRadioCpm(rate / 100,line.audience ?? null)) ?? [];
        });
        if (!amounts.length) continue;
        const low = Math.min(...amounts), high = Math.max(...amounts);
        const sourceCell = periods[0].source.locator ?? '';
        cells[index] = low === high ? moneyCell(low,sourceCell) :
          [low,high].map(value => cellText(moneyCell(value,sourceCell))).join('–');
      }
    }
    if (query.quotesOnly && line?.rate == null && !periods?.length) continue;
    if (contains([title, entry.rep, entry.firm, source?.title, ...cells.map(cellText)], query.q)) {
      rows.push({ id: row.id, marketId: query.marketId, market,
      program: title, firm: file?.firm || entry.firm, rep: file?.rep || entry.rep, cells, source, line,
      ...(periods?.length && {periods}) });
    }
  }
  return rows;
}
