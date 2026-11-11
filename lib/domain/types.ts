// JSON shapes are retained at the legacy API boundary; inputs are validated by each domain module.
export type Data = Record<string, any>;
export type Cell = { input: any; formula: string | null; value: any; sourceInput: any; sourceFormula: string | null; sourceValue: any; style: number; note: string };
export type Workbook = {
  sheets: Record<string, Record<string, Cell>>;
  metadata: Data; styles: Data[]; periods: Data[]; links: Record<string, string>;
  changes: Data[]; variableChanges: Data[]; orderDrafts: Record<string, Data>;
};
export class InputError extends Error {}
export class Conflict extends Error {}
export function check(condition: unknown, message: string): asserts condition { if (!condition) throw new InputError(message); }
export function object(value: unknown): value is Data { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function day(value: any, label: string): string {
  if (value === '' || value == null) return '';
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), label + ' must be a valid date.');
  const d = new Date(value + 'T00:00:00Z');
  check(!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value, label + ' must be a valid date.');
  return value;
}
export function datePair(start: string, end: string, label: string) { check(!start || !end || start <= end, label + ': end date must be on or after start date.'); }
