export const batchKey = 'epic3/2027-research';

export const sheetLabels = {
  tv: 'TV',
  radio: 'Radio',
  demographics: 'Demographics',
  notes: 'Notes',
  reference: 'Reference',
} as const;

export type SheetName = keyof typeof sheetLabels;
export type SourceFile = { id: string; name: string; market: string | null; rep: string; firm: string; marketId?: string | null };
export type SourceGroup = { files: SourceFile[] };
export type MarketOption = { id: string; name: string };
export type MarketIssue = { key: string; sourceMarket: string; candidates: string[] };
export type Cell = { value: number | null; unit: string; locator: string; raw: string };
export type CellValue = Cell | string | number | null;

export type ResearchRow = {
  id: string;
  market: string;
  client: string;
  period?: string;
  cells: CellValue[];
  sourceKeys: string[];
  sourceMarketId?: string;
  issue?: MarketIssue;
  attention?: boolean;
  locator?: string;
};

export type ResearchSheet = {
  columns: { label: string; width: number }[];
  groups?: { label: string; span: number }[];
  rows: ResearchRow[];
  sources: Record<string, SourceGroup>;
  markets?: MarketOption[];
  totals: { values: number; files: number; submissions: number };
};

export type SavedMarket = { review_key: string; market_id: string; market_name: string };

export const radioCpmFormula = 'Spot rate × 1,000 ÷ AQH (people)';

export function calculateRadioCpm(spotRate: number | null, aqh: number | null): number | null {
  if (spotRate === null || aqh === null || !Number.isFinite(spotRate) || !Number.isFinite(aqh) || spotRate < 0 || aqh <= 0) {
    return null;
  }
  const cpm = spotRate / (aqh / 1000);
  return Number.isFinite(cpm) ? cpm : null;
}

export function isSheetName(name: string): name is SheetName {
  return Object.hasOwn(sheetLabels, name);
}
