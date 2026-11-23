import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { archiveReferenceRoles, validateOrderArchive, type ArchiveFile, type ArchiveRecord, type CoverageEvidence } from '../lib/orders/archive-source';

const { values } = parseArgs({ options: {
  current: { type: 'string' }, families: { type: 'string' }, coverage: { type: 'string' },
  billing: { type: 'string' }, output: { type: 'string' },
} });

async function json(file: string) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  if (!values.current || !values.families || !values.output || !isAbsolute(values.output) ||
      !relative(process.cwd(), values.output).startsWith('../')) {
    throw new Error('Pass --current, --families and an absolute --output path outside this checkout. --coverage and --billing are optional.');
  }
  const [current, families, reference, billingReference] = await Promise.all([
    json(values.current), json(values.families), values.coverage ? json(values.coverage) : Promise.resolve(null),
    values.billing ? json(values.billing) : Promise.resolve(null),
  ]);
  type DocumentFamily = Omit<ArchiveRecord, 'source' | 'version' | 'signedBy' | 'related'> & {
    file: string; files: string[]; scope: string; rev: string; signer: string;
  };
  const reviewedFamilies: DocumentFamily[] = families.orders;
  const familyById = new Map(reviewedFamilies.map(order => [String(order.id), order]));
  const files: Record<string, ArchiveFile> = {};
  function include(fileId: string) {
    const file = current.files[fileId] ?? families.files[fileId];
    if (!file) throw new Error('A reviewed source document is missing.');
    files[fileId] = { ...file, id: fileId };
  }
  const digitalVendorCompanion: Record<string, string> = { '23':'24', '200':'201', '218':'217', '18':'19', '220':'221' };
  function withSources(order: Omit<ArchiveRecord, 'signed' | 'related'>) {
    const id = String(order.id);
    const source = String(order.source);
    const family = familyById.get(id);
    if (!family) throw new Error('A current order is missing its reviewed document family.');
    const signed = family.signed ? String(family.signed) : null;
    const related = family.files.map(String);
    if (digitalVendorCompanion[source]) related.push(digitalVendorCompanion[source]);
    const uniqueRelated = [...new Set(related)].filter(key => key !== source && key !== signed);
    for (const key of [source, signed, ...uniqueRelated]) if (key) include(key);
    const lines = order.lines.map(line => ({
      ...line, flight: line.flight ?? '', days: line.days ?? '', weeks: line.weeks ?? '',
      impressions: line.impressions ?? '', area: line.area ?? '', client: line.client ?? '',
      fmt: line.fmt ?? '', context: line.context ?? '', amount: line.amount ?? null,
    }));
    return { ...order, id, source, signed, related: uniqueRelated, lines };
  }
  const orders: ArchiveRecord[] = current.orders.map(withSources);
  const currentIds = new Set(orders.map(order => order.id));
  const references = reviewedFamilies.filter(family => !currentIds.has(String(family.id))).map(family => {
    const { id, market, name, type, issued, ref, client, media, amount, basis, imps, targets, lines, note } = family;
    const referenceRole = archiveReferenceRoles.find(role => role === family.scope);
    if (!referenceRole) throw new Error('A reviewed order is missing from the current archive: ' + id);
    return { ...withSources({ id, market, name, type, issued, ref, client, media, amount, basis, imps, targets, lines, note,
      source: family.file, version: family.rev, signedBy: family.signer, signedOn: family.signedOn }), referenceRole };
  });
  const coverage: CoverageEvidence[] = [];
  if (reference) {
    const published = new Set(['2027 research','2027 submission']);
    for (const option of reference.options) {
      const evidence = option.e.filter((item: string) => published.has(item));
      if (!evidence.length || !option.f || !option.r) continue;
      coverage.push({ clientId: option.c, marketId: option.m, firm: option.f, rep: option.r,
        media: option.media, evidence });
    }
  }
  const billing = {};
  if (billingReference) {
    const weather = orders.find((order: ArchiveRecord) => order.source === '200' && order.signed === '200');
    const reviewed = billingReference.digital?.opportunities?.find((option: {sourceOrder?: {id:string}}) =>
      option.sourceOrder?.id === '200')?.priorBilling;
    if (!weather || reviewed?.number !== '#2025_weather_EPIC3' || reviewed.amount !== 75000) {
      throw new Error('The verified 2025 Weather invoice reference is missing.');
    }
    Object.assign(billing, { [weather.id]: { ...reviewed, year: 2025, amount: Math.round(reviewed.amount * 100) } });
  }
  const archive = validateOrderArchive({
    version: 1, year: 2026, orders, references, files, marketIds: { ...families.marketIds, ...current.marketIds },
    coverage, coverageYear: reference?.year ?? null, billing,
  });
  // Exclusive creation prevents overwriting a previously reviewed release.
  await writeFile(values.output, JSON.stringify(archive), { flag: 'wx', mode: 0o600 });
  const placements = [...archive.orders, ...(archive.references ?? [])].reduce((total, order) => total + order.lines.length, 0);
  console.log(`Prepared ${archive.orders.length} orders, ${archive.references?.length ?? 0} reference records, ${placements} placement and adjustment rows, ` +
    `${Object.keys(archive.files).length} original source links, ${archive.coverage.length} market coverage references and ` +
    `${Object.keys(billing).length} billing references.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unable to prepare the reviewed order archive.');
  process.exitCode = 1;
});
